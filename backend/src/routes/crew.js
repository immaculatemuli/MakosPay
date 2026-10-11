// Vehicle crew (conductor or driver): their vehicle, every payment made on it, and checking tickets.
// Only the conductor can change the vehicle's route. Crew can never change fares, wallets or payouts.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { getRoute, listRoutes } from '../services/routes.js';
import { TRIP_SELECT } from '../services/trips.js';
import { maskPhone, nairobiDayRange, nairobiToday } from '../util.js';
import { id, parse } from '../validate.js';

const router = Router();

// The column on vehicles that links each crew role to its vehicle.
const CREW_COLUMN = { conductor: 'conductor_id', driver: 'driver_id' };

/** The vehicle this conductor or driver works on. */
function myVehicle(user) {
  const column = CREW_COLUMN[user.role];
  const vehicle = column && db.prepare(`SELECT * FROM vehicles WHERE ${column} = ? AND is_active = 1`).get(user.id);
  if (!vehicle) throw new HttpError(404, 'NO_VEHICLE', 'You are not on a vehicle yet. Ask the SACCO office to add you to one.');
  return vehicle;
}

// Crew see who paid, but not passengers' full phone numbers or the owner's payout details.
const forCrew = ({ passenger_phone, owner_name, owner_phone, payout_id, ...trip }) => ({ ...trip, passenger_phone: maskPhone(passenger_phone) });

function daySummary(vehicleId, date) {
  const [from, to] = nairobiDayRange(date);
  return db
    .prepare("SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS total FROM trips WHERE vehicle_id = ? AND status = 'paid' AND created_at >= ? AND created_at < ?")
    .get(vehicleId, from, to);
}

const vehicleView = (vehicle) => {
  const route = vehicle.route_id ? getRoute(vehicle.route_id) : null;
  return {
    vehicle: { id: vehicle.id, plate: vehicle.plate, description: vehicle.description },
    route: route && { id: route.id, name: route.name, origin: route.origin, stops: route.stops },
  };
};

router.get('/vehicle', (req, res) => {
  const vehicle = myVehicle(req.user);
  res.json({ ...vehicleView(vehicle), today: daySummary(vehicle.id, nairobiToday()) });
});

// Payments on this vehicle on one day (default today, Kenyan time), newest first.
router.get('/payments', (req, res) => {
  const { date } = parse(z.object({ date: z.string().date().default(nairobiToday) }), req.query);
  const vehicle = myVehicle(req.user);
  const [from, to] = nairobiDayRange(date);
  const trips = db.prepare(`${TRIP_SELECT} WHERE t.vehicle_id = ? AND t.created_at >= ? AND t.created_at < ? ORDER BY t.id DESC`).all(vehicle.id, from, to);
  res.json({ date, summary: daySummary(vehicle.id, date), payments: trips.map(forCrew) });
});

// Check the ticket code a passenger shows.
router.get('/tickets/:code', (req, res) => {
  const vehicle = myVehicle(req.user);
  const trip = db.prepare(`${TRIP_SELECT} WHERE t.ticket_code = ?`).get(req.params.code.trim().toUpperCase());
  if (!trip || trip.vehicle_id !== vehicle.id) {
    throw new HttpError(404, 'TICKET_NOT_FOUND', 'No ticket with this code was paid on your vehicle');
  }
  const [from, to] = nairobiDayRange(nairobiToday());
  res.json({ is_today: trip.created_at >= from && trip.created_at < to, refunded: trip.status === 'refunded', payment: forCrew(trip) });
});

router.get('/routes', (_req, res) => {
  res.json(listRoutes({ activeOnly: true }).map(({ id: routeId, name, origin, stops }) => ({ id: routeId, name, origin, stops })));
});

// The vehicle is plying a different route today: passengers who scan after this pay that route's fares. Conductor only.
router.put('/vehicle/route', (req, res) => {
  if (req.user.role !== 'conductor') throw new HttpError(403, 'FORBIDDEN', 'Only the conductor can change the route');
  const { route_id } = parse(z.object({ route_id: id }), req.body);
  const vehicle = myVehicle(req.user);
  const route = getRoute(route_id);
  if (!route || !route.is_active || route.stops.length === 0) throw notFound('Route');
  db.prepare('UPDATE vehicles SET route_id = ? WHERE id = ?').run(route.id, vehicle.id);
  res.json(vehicleView({ ...vehicle, route_id: route.id }));
});

export default router;
