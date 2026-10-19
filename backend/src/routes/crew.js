// Vehicle crew (conductor or driver): their vehicle, every payment made on it, checking tickets and reporting problems.
// Only the conductor can change the vehicle's route. Crew can never change fares, wallets or payouts.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { boardBooking, crewLoad, departLoad, finishTrip, isLoading, reachStop, startLoading } from '../services/bookings.js';
import { arriveParcel, collectParcel, crewParcels, loadParcel } from '../services/parcels.js';
import { boardSeat, crewSeats, saveCarLocation } from '../services/seats.js';
import { fileReport, getPhoto, myReports, replySchema, reporterReply, reportSchema, sendPhoto } from '../services/reports.js';
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

/**
 * The car's latest trip today: from when it started loading at the stage until it finished (or until now, while
 * it is still on it), with the fares paid on the car in that time. Null if the car has started no trip today.
 */
async function tripSummary(vehicleId) {
  const [today] = nairobiDayRange(nairobiToday());
  const trip = await db.get(
    `SELECT l.id, l.started_at, l.departed_at, l.finished_at, r.name AS route_name
     FROM loads l JOIN routes r ON r.id = l.route_id
     WHERE l.vehicle_id = ? AND l.started_at >= ? ORDER BY l.id DESC LIMIT 1`,
    vehicleId,
    today,
  );
  if (!trip) return null;
  const until = trip.finished_at ?? new Date(Date.now() + 60_000).toISOString();
  const totals = await db.get(
    "SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS total FROM trips WHERE vehicle_id = ? AND status = 'paid' AND created_at >= ? AND created_at < ?",
    vehicleId,
    trip.started_at,
    until,
  );
  return { ...trip, ...totals };
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
  res.json({
    date,
    summary: await daySummary(vehicle.id, date),
    trip: date === nairobiToday() ? await tripSummary(vehicle.id) : null,
    payments: trips.map(forCrew),
  });
});

// A quick look the conductor's phone takes every few seconds: the newest payment on the car today and how many were
// refunded. Only when either changes does the phone load the full list (and ring for the new payments).
router.get('/payments/latest', async (req, res) => {
  const vehicle = await myVehicle(req.user);
  const [from, to] = nairobiDayRange(nairobiToday());
  const row = await db.get(
    "SELECT COALESCE(MAX(id), 0) AS latest_id, COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded FROM trips WHERE vehicle_id = ? AND created_at >= ? AND created_at < ?",
    vehicle.id,
    from,
    to,
  );
  res.json({ latest_id: Number(row.latest_id), refunded: Number(row.refunded) });
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
  res.json(await myReports(req.user.id));
});

// A photo on one of your own reports.
router.get('/reports/:id/photos/:photoId', async (req, res) => {
  const photo = await getPhoto(parse(id, req.params.id), parse(id, req.params.photoId), { reporterId: req.user.id });
  sendPhoto(res, photo);
});

// Writing more on one of your own reports (opens it again if it was resolved).
router.post('/reports/:id/messages', async (req, res) => {
  res.status(201).json(await reporterReply(req.user, parse(id, req.params.id), parse(replySchema, req.body)));
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

// Seat bookings put on this car: who to pick where (at the stage or on the road), and ticking them on.
router.get('/seats', async (req, res) => {
  res.json(await crewSeats((await myVehicle(req.user)).id));
});

router.post('/seats/:id/board', async (req, res) => {
  const vehicle = await myVehicle(req.user);
  await boardSeat(parse(id, req.params.id), { vehicleId: vehicle.id });
  res.json(await crewSeats(vehicle.id));
});

// Where the car is, from the crew's phone while on a trip (shown to the passengers it picks and the marshals).
router.post('/location', async (req, res) => {
  const body = parse(
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      heading: z.number().nullable().optional(),
      speed: z.number().nullable().optional(),
      accuracy: z.number().nullable().optional(),
    }),
    req.body,
  );
  req.skipAudit = true;
  res.json({ shared: await saveCarLocation((await myVehicle(req.user)).id, body) });
});

// On the road: the car reached a stop (passengers who booked see it), and the end of the trip.
router.post('/road/stops/:id', async (req, res) => {
  res.json(await reachStop(await myVehicle(req.user), parse(id, req.params.id)));
});

router.post('/road/finish', async (req, res) => {
  res.json(await finishTrip(await myVehicle(req.user)));
});

// ---------- Parcels ----------

// Paid parcels waiting for this car's route, and the parcels on this car.
router.get('/parcels', async (req, res) => {
  res.json(await crewParcels(await myVehicle(req.user)));
});

router.post('/parcels/:id/load', async (req, res) => {
  res.json(await loadParcel(await myVehicle(req.user), parse(id, req.params.id)));
});

router.post('/parcels/:id/arrive', async (req, res) => {
  res.json(await arriveParcel(await myVehicle(req.user), parse(id, req.params.id)));
});

// Handed to the receiver, who showed the collection code.
router.post('/parcels/:id/collect', async (req, res) => {
  const vehicle = await myVehicle(req.user);
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The 6-digit collection code') }), req.body);
  await collectParcel(parse(id, req.params.id), code, req.user.id, { vehicleId: vehicle.id });
  res.json(await crewParcels(vehicle));
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
