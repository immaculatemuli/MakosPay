// Vehicle crew (conductor or driver): their vehicle, every payment made on it, checking tickets and reporting problems.
// Only the conductor can change the vehicle's route. Crew can never change fares, wallets or payouts.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { boardBooking, crewLoad, departLoad, isLoading, startLoading } from '../services/bookings.js';
import { fileReport, REPORT_SELECT, reportSchema } from '../services/reports.js';
import { getRoute, listRoutes } from '../services/routes.js';
import { TRIP_SELECT } from '../services/trips.js';
import { maskPhone, nairobiDayRange, nairobiToday } from '../util.js';
import { id, parse } from '../validate.js';

const router = Router();

// The column on vehicles that links each crew role to its vehicle.
const CREW_COLUMN = { conductor: 'conductor_id', driver: 'driver_id' };

/** The vehicle this conductor or driver works on. */
async function myVehicle(user) {
  const column = CREW_COLUMN[user.role];
  const vehicle = column && (await db.get(`SELECT * FROM vehicles WHERE ${column} = ? AND is_active = TRUE`, user.id));
  if (!vehicle) throw new HttpError(404, 'NO_VEHICLE', 'You are not on a vehicle yet. Ask the SACCO office to add you to one.');
  return vehicle;
}

// Crew see who paid, but not passengers' full phone numbers or the owner's payout details.
const forCrew = ({ passenger_phone, owner_name, owner_phone, payout_id, ...trip }) => ({ ...trip, passenger_phone: maskPhone(passenger_phone) });

function daySummary(vehicleId, date) {
  const [from, to] = nairobiDayRange(date);
  return db.get(
    "SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS total FROM trips WHERE vehicle_id = ? AND status = 'paid' AND created_at >= ? AND created_at < ?",
    vehicleId,
    from,
    to,
  );
}

const vehicleView = async (vehicle) => {
  const route = vehicle.route_id ? await getRoute(vehicle.route_id) : null;
  return {
    vehicle: { id: vehicle.id, plate: vehicle.plate, description: vehicle.description },
    route: route && { id: route.id, name: route.name, origin: route.origin, stops: route.stops },
  };
};

router.get('/vehicle', async (req, res) => {
  const vehicle = await myVehicle(req.user);
  res.json({ ...(await vehicleView(vehicle)), today: await daySummary(vehicle.id, nairobiToday()) });
});

// Payments on this vehicle on one day (default today, Kenyan time), newest first.
router.get('/payments', async (req, res) => {
  const { date } = parse(z.object({ date: z.string().date().default(nairobiToday) }), req.query);
  const vehicle = await myVehicle(req.user);
  const [from, to] = nairobiDayRange(date);
  const trips = await db.all(`${TRIP_SELECT} WHERE t.vehicle_id = ? AND t.created_at >= ? AND t.created_at < ? ORDER BY t.id DESC`, vehicle.id, from, to);
  res.json({ date, summary: await daySummary(vehicle.id, date), payments: trips.map(forCrew) });
});

// Check the ticket code a passenger shows.
router.get('/tickets/:code', async (req, res) => {
  const vehicle = await myVehicle(req.user);
  const trip = await db.get(`${TRIP_SELECT} WHERE t.ticket_code = ?`, req.params.code.trim().toUpperCase());
  if (!trip || trip.vehicle_id !== vehicle.id) {
    throw new HttpError(404, 'TICKET_NOT_FOUND', 'No ticket with this code was paid on your vehicle');
  }
  const [from, to] = nairobiDayRange(nairobiToday());
  res.json({ is_today: trip.created_at >= from && trip.created_at < to, refunded: trip.status === 'refunded', payment: forCrew(trip) });
});

// ---------- Problem reports from crew ----------

router.post('/reports', async (req, res) => {
  const body = parse(reportSchema, req.body);
  res.status(201).json(await fileReport(req.user, body, { vehicleId: (await myVehicle(req.user)).id }));
});

router.get('/reports', async (req, res) => {
  const rows = await db.all(`${REPORT_SELECT} WHERE r.reporter_id = ? ORDER BY r.id DESC LIMIT 50`, req.user.id);
  res.json(rows.map(({ reporter_phone, handled_by, ...r }) => r));
});

router.get('/routes', async (_req, res) => {
  res.json((await listRoutes({ activeOnly: true })).map(({ id: routeId, name, origin, stops }) => ({ id: routeId, name, origin, stops })));
});

// ---------- Seat bookings: the car loading at the stage ----------

// The car's current loading and its booked passengers (or { loading: null }).
router.get('/loading', async (req, res) => {
  res.json(await crewLoad(await myVehicle(req.user)));
});

// The car is at the stage: passengers can book seats on it.
router.post('/loading/start', async (req, res) => {
  res.status(201).json(await startLoading(await myVehicle(req.user), req.user.id));
});

// The car has left: no more bookings on it.
router.post('/loading/depart', async (req, res) => {
  res.json(await departLoad(await myVehicle(req.user)));
});

// A booked passenger got on.
router.post('/bookings/:id/board', async (req, res) => {
  res.json(await boardBooking(await myVehicle(req.user), parse(id, req.params.id)));
});

// The vehicle is plying a different route today: passengers who scan after this pay that route's fares. Conductor only.
router.put('/vehicle/route', async (req, res) => {
  if (req.user.role !== 'conductor') throw new HttpError(403, 'FORBIDDEN', 'Only the conductor can change the route');
  const { route_id } = parse(z.object({ route_id: id }), req.body);
  const vehicle = await myVehicle(req.user);
  if (await isLoading(vehicle.id)) throw new HttpError(409, 'LOADING', 'The car is taking bookings. Mark it as left before changing the route.');
  const route = await getRoute(route_id);
  if (!route || !route.is_active || route.stops.length === 0) throw notFound('Route');
  await db.run('UPDATE vehicles SET route_id = ? WHERE id = ?', route.id, vehicle.id);
  res.json(await vehicleView({ ...vehicle, route_id: route.id }));
});

export default router;
