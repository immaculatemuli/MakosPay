// Seat booking on the next car loading at the stage. The conductor starts "loading" when the car is at the stage;
// passengers book and pay for seats on the website; the conductor sees who booked and ticks them in as they board,
// then marks the car as left. A booking is paid like any fare (M-Pesa PIN prompt, then a trip on the vehicle), so
// owner payouts, refunds and the nightly money check include it with no extra rules.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { maskPhone, randomCode } from '../util.js';
import { passengerFor } from './noapp.js';
import { getPayment, refreshPayment, requireMpesa, sendPrompt } from './payments.js';
import { applyDueFareChanges, getRoute, listRoutes, requireActiveStop } from './routes.js';
import { recordTrip, refundTrip } from './trips.js';

export const MAX_SEATS_PER_BOOKING = 10;
const TOKEN_AUDIENCE = 'farepay-booking';

// A booking's fare: taken from the wallet (b.trip_id), or recorded when M-Pesa confirmed (p.trip_id).
const PAID_TRIP = 'COALESCE(b.trip_id, p.trip_id)';

// Seats a booking holds: while its PIN prompt waits for an answer, and once paid (until refunded).
// A failed or cancelled payment frees them straight away.
const HOLDS_SEATS = `(p.status IN ('initiating', 'pending') OR t.status = 'paid')`;

async function seatsTaken(loadId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(b.seats), 0) AS taken FROM bookings b
     LEFT JOIN mpesa_payments p ON p.id = b.mpesa_payment_id LEFT JOIN trips t ON t.id = ${PAID_TRIP}
     WHERE b.load_id = ? AND ${HOLDS_SEATS}`,
    loadId,
  );
  return row.taken;
}

/** Cars loading now on a route, first come first served, each with its seats left. */
async function loadingCars(routeId) {
  const loads = await db.all(
    `SELECT l.*, v.plate, v.description FROM loads l JOIN vehicles v ON v.id = l.vehicle_id
     WHERE l.route_id = ? AND l.status = 'loading' AND v.is_active = TRUE ORDER BY l.started_at, l.id`,
    routeId,
  );
  const cars = [];
  for (const load of loads) cars.push({ ...load, seats_left: Math.max(0, load.seats - (await seatsTaken(load.id))) });
  return cars;
}

// ---------- Passengers (the website) ----------

/** Routes passengers can book on, with their stops and fares and the seats on cars loading now. */
export async function routesForBooking() {
  const routes = await listRoutes({ activeOnly: true });
  const result = [];
  for (const r of routes) {
    const cars = await loadingCars(r.id);
    const next = cars.find((c) => c.seats_left > 0);
    result.push({
      id: r.id,
      name: r.name,
      origin: r.origin,
      stops: r.stops.map((s) => ({ id: s.id, name: s.name, fare: s.app_fare })),
      cars_loading: cars.length,
      seats_left: cars.reduce((sum, c) => sum + c.seats_left, 0),
      next_car: next ? { plate: next.plate, seats_left: next.seats_left } : null,
    });
  }
  return result;
}

const tokenFor = (bookingId) => jwt.sign({ bid: bookingId }, config.jwtSecret, { audience: TOKEN_AUDIENCE, expiresIn: '7d' });

function bookingIdFrom(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { audience: TOKEN_AUDIENCE }).bid;
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Booking not found. Open the link from your booking again.');
  }
}

async function uniqueBookingCode() {
  for (;;) {
    const code = randomCode(6);
    if (!(await db.get('SELECT 1 FROM bookings WHERE code = ?', code))) return code;
  }
}

/**
 * Books `seats` seats to `stopId` on the first car loading on the route with that many seats left. Paid by the
 * M-Pesa PIN prompt (the seats are held while it waits, and kept once paid), or, for a passenger signed in to the
 * app (`passengerId`), from their FarePay wallet at once. The same confirmation sent twice (idempotencyKey) returns
 * the first booking and charges nothing more.
 */
export async function startBooking({ routeId, stopId, seats, expectedFare, phone, idempotencyKey, passengerId: signedIn = null, payWith = 'mpesa' }) {
  if (payWith === 'mpesa') requireMpesa();
  await applyDueFareChanges();
  const passengerId = signedIn ?? (await passengerFor(phone));
  const previous = await db.get('SELECT id FROM bookings WHERE passenger_id = ? AND idempotency_key = ?', passengerId, idempotencyKey);
  if (previous) return { id: previous.id, booking_token: tokenFor(previous.id), ...(await bookingStatus(previous.id)) };

  const route = await getRoute(routeId);
  if (!route || !route.is_active) throw notFound('Route');
  const created = await tx(async () => {
    const stop = await requireActiveStop(routeId, stopId);
    if (stop.app_fare !== expectedFare) {
      throw new HttpError(409, 'FARE_CHANGED', 'The fare has changed. Please check the new fare and book again.', { fare: stop.app_fare });
    }
    const cars = await loadingCars(routeId);
    const car = cars.find((c) => c.seats_left >= seats);
    if (!car) {
      const most = Math.max(0, ...cars.map((c) => c.seats_left));
      if (cars.length === 0 || most === 0) {
        throw new HttpError(409, 'NO_CAR_LOADING', `No ${config.saccoName} car is taking bookings on ${route.name} right now. Please check again in a few minutes.`);
      }
      throw new HttpError(409, 'NOT_ENOUGH_SEATS', `Only ${most} seat${most === 1 ? '' : 's'} left on the car loading now. Book fewer seats, or wait for the next car.`, { seats_left: most });
    }
    const amount = stop.app_fare * seats;
    if (payWith === 'wallet') {
      // Taken from the wallet now, as one fare on the car (refused if the wallet is short).
      const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', car.vehicle_id);
      const tripId = await recordTrip({ passengerId, vehicle, stop, fare: amount, idempotencyKey });
      const bookingId = await db.insert(
        `INSERT INTO bookings (code, load_id, passenger_id, stop_id, seats, fare_each, amount, trip_id, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        await uniqueBookingCode(),
        car.id,
        passengerId,
        stop.id,
        seats,
        stop.app_fare,
        amount,
        tripId,
        idempotencyKey,
      );
      return { bookingId };
    }
    // Recorded before the prompt is sent, so the seats are held and a fast confirmation always finds its payment.
    const paymentId = await db.insert(
      `INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, vehicle_id, stop_id, idempotency_key)
       VALUES (?, ?, ?, 'fare', 'initiating', ?, ?, ?)`,
      passengerId,
      phone,
      amount,
      car.vehicle_id,
      stop.id,
      idempotencyKey,
    );
    const bookingId = await db.insert(
      `INSERT INTO bookings (code, load_id, passenger_id, stop_id, seats, fare_each, amount, mpesa_payment_id, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      await uniqueBookingCode(),
      car.id,
      passengerId,
      stop.id,
      seats,
      stop.app_fare,
      amount,
      paymentId,
      idempotencyKey,
    );
    return { bookingId, paymentId, amount, plate: car.plate };
  });
  if (created.paymentId) {
    await sendPrompt(created.paymentId, {
      phone,
      amount: created.amount,
      accountReference: created.plate.replace(/\W/g, ''),
      description: 'Seat booking',
    });
  }
  return { id: created.bookingId, booking_token: tokenFor(created.bookingId), ...(await bookingStatus(created.bookingId)) };
}

const BOOKING_SELECT = `
  SELECT b.*, l.status AS car_status, l.vehicle_id, l.route_id, l.started_at AS loading_since, l.departed_at,
         v.plate, v.description AS vehicle_description, r.name AS route_name, r.origin, s.name AS stop_name,
         p.status AS payment_status, p.result_desc, ${PAID_TRIP} AS paid_trip_id, t.status AS trip_status,
         u.name AS passenger_name, u.phone AS passenger_phone
  FROM bookings b
  JOIN loads l ON l.id = b.load_id
  JOIN vehicles v ON v.id = l.vehicle_id
  JOIN routes r ON r.id = l.route_id
  JOIN route_stops s ON s.id = b.stop_id
  JOIN users u ON u.id = b.passenger_id
  LEFT JOIN mpesa_payments p ON p.id = b.mpesa_payment_id
  LEFT JOIN trips t ON t.id = ${PAID_TRIP}`;

/** paying | confirmed | boarded | departed | cancelled | failed | paid_late */
function statusOf(b) {
  if (b.payment_status === 'initiating' || b.payment_status === 'pending') return 'paying';
  if (b.payment_status === 'failed') return 'failed';
  if (!b.paid_trip_id) return 'paid_late'; // M-Pesa confirmed after FarePay gave up waiting: the money went to the wallet
  if (b.trip_status === 'refunded') return 'cancelled';
  if (b.boarded_at) return 'boarded';
  if (b.car_status === 'departed') return 'departed';
  return 'confirmed';
}

/** A booking as the passenger sees it (asks M-Pesa first if the payment is still waiting). */
export async function bookingStatus(bookingId) {
  const before = await db.get('SELECT mpesa_payment_id FROM bookings WHERE id = ?', bookingId);
  if (!before) throw notFound('Booking');
  const payment = await getPayment(before.mpesa_payment_id);
  if (payment) await refreshPayment(payment);
  const b = await db.get(`${BOOKING_SELECT} WHERE b.id = ?`, bookingId);
  const status = statusOf(b);
  const load = await db.get('SELECT * FROM loads WHERE id = ?', b.load_id);
  const stops = await tripStops(load);
  const mine = stops.find((x) => x.id === b.stop_id);
  const minutes = b.departed_at && mine && !mine.reached_at && !load.finished_at ? await typicalMinutes(b.stop_id) : null;
  // Cars that started loading on this route before this one and are still loading (they leave first).
  const ahead =
    b.car_status === 'loading'
      ? (await db.get("SELECT COUNT(*) AS n FROM loads WHERE route_id = ? AND status = 'loading' AND started_at < ?", b.route_id, b.loading_since)).n
      : 0;
  return {
    status,
    code: b.code,
    seats: b.seats,
    fare_each: b.fare_each,
    amount: b.amount,
    reason: status === 'failed' ? b.result_desc : null,
    booked_at: b.created_at,
    route: { name: b.route_name, origin: b.origin },
    stop_name: b.stop_name,
    car: {
      plate: b.plate,
      description: b.vehicle_description,
      status: b.car_status, // loading | departed
      loading_since: b.loading_since,
      departed_at: b.departed_at,
      finished_at: load.finished_at,
      cars_ahead: ahead,
      seats_left: b.car_status === 'loading' ? Math.max(0, load.seats - (await seatsTaken(load.id))) : null,
      // The route's stops in order, with when the car reached each on this trip (null = not yet).
      stops: stops.map((x) => ({ name: x.name, reached_at: x.reached_at, mine: x.id === b.stop_id })),
      reached_my_stop: Boolean(mine?.reached_at),
      // From how long past trips on this route took; null until there are some, or once the car is there.
      expected_at_my_stop: minutes === null ? null : new Date(Date.parse(b.departed_at) + minutes * 60_000).toISOString(),
    },
    can_cancel: status === 'confirmed',
  };
}

/** The route's current stops in order, each with when this trip's car reached it (null = not yet). */
function tripStops(load) {
  return db.all(
    `SELECT s.id, s.name, ls.reached_at FROM route_stops s
     LEFT JOIN load_stops ls ON ls.stop_id = s.id AND ls.load_id = ?
     WHERE s.route_id = ? AND s.is_active = TRUE ORDER BY s.position, s.id`,
    load.id,
    load.route_id,
  );
}

/**
 * Usual minutes from leaving the stage to reaching a stop: the middle value of the last 20 trips that reached it
 * (ignoring anything over 6 hours, e.g. a stop ticked the next day). null when no trip has reached it yet.
 */
export async function typicalMinutes(stopId) {
  const rows = await db.all(
    `SELECT l.departed_at, ls.reached_at FROM load_stops ls JOIN loads l ON l.id = ls.load_id
     WHERE ls.stop_id = ? AND l.departed_at IS NOT NULL ORDER BY ls.id DESC LIMIT 20`,
    stopId,
  );
  const minutes = rows
    .map((r) => (Date.parse(r.reached_at) - Date.parse(r.departed_at)) / 60_000)
    .filter((m) => m > 0 && m < 360)
    .sort((a, b) => a - b);
  return minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]) : null;
}

export const bookingStatusByToken = (token) => bookingStatus(bookingIdFrom(token));

/** The passenger cancels before boarding, while the car is still at the stage: the money goes back to their FarePay wallet. */
async function cancelById(bookingId) {
  const b = await db.get(`${BOOKING_SELECT} WHERE b.id = ?`, bookingId);
  if (!b) throw notFound('Booking');
  if (statusOf(b) !== 'confirmed') {
    throw new HttpError(409, 'CANNOT_CANCEL', 'This booking can no longer be cancelled (it is not paid, the passenger has boarded, or the car has left).');
  }
  await refundTrip(b.paid_trip_id, `Seat booking ${b.code} cancelled by the passenger`);
  return bookingStatus(bookingId);
}

export const cancelBooking = (token) => cancelById(bookingIdFrom(token));

// ---------- Passengers signed in to the app ----------

async function myBookingId(passengerId, bookingId) {
  const b = await db.get('SELECT id FROM bookings WHERE id = ? AND passenger_id = ?', bookingId, passengerId);
  if (!b) throw notFound('Booking');
  return b.id;
}

/** One of this passenger's bookings. */
export const passengerBooking = async (passengerId, bookingId) => ({ id: bookingId, ...(await bookingStatus(await myBookingId(passengerId, bookingId))) });

export const cancelPassengerBooking = async (passengerId, bookingId) => ({ id: bookingId, ...(await cancelById(await myBookingId(passengerId, bookingId))) });

/** This passenger's bookings from the last 7 days, newest first (failed ones left out). */
export async function passengerBookings(passengerId) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = await db.all('SELECT id FROM bookings WHERE passenger_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 20', passengerId, since);
  const result = [];
  for (const { id: bookingId } of rows) {
    const b = await bookingStatus(bookingId);
    if (b.status !== 'failed') result.push({ id: bookingId, ...b });
  }
  return result;
}

// ---------- Office: cars loading and trips ----------

const LOAD_SELECT = `
  SELECT l.*, v.plate, r.name AS route_name, r.origin, u.name AS started_by_name
  FROM loads l JOIN vehicles v ON v.id = l.vehicle_id JOIN routes r ON r.id = l.route_id LEFT JOIN users u ON u.id = l.started_by`;

/** loading | on_the_road | finished */
const tripState = (l) => (l.status === 'loading' ? 'loading' : l.finished_at ? 'finished' : 'on_the_road');

async function loadSummary(l) {
  const stops = await tripStops(l);
  const money = await db.get(
    `SELECT COUNT(*) AS bookings, COALESCE(SUM(b.amount), 0) AS amount FROM bookings b
     LEFT JOIN mpesa_payments p ON p.id = b.mpesa_payment_id LEFT JOIN trips t ON t.id = ${PAID_TRIP}
     WHERE b.load_id = ? AND t.status = 'paid'`,
    l.id,
  );
  return {
    id: l.id,
    plate: l.plate,
    route_name: l.route_name,
    origin: l.origin,
    state: tripState(l),
    seats: l.seats,
    seats_booked: await seatsTaken(l.id),
    paid_bookings: money.bookings,
    booking_money: money.amount,
    stops_reached: stops.filter((s) => s.reached_at).length,
    stops_total: stops.length,
    started_by_name: l.started_by_name,
    started_at: l.started_at,
    departed_at: l.departed_at,
    finished_at: l.finished_at,
  };
}

/** Every car that loaded on a day (Kenyan time, `from`–`to`), and right now: cars loading and trips on the road. */
export async function officeTrips(from, to) {
  const loads = await db.all(
    `${LOAD_SELECT} WHERE (l.started_at >= ? AND l.started_at < ?) OR l.status = 'loading' OR (l.status = 'departed' AND l.finished_at IS NULL)
     ORDER BY l.started_at DESC, l.id DESC`,
    from,
    to,
  );
  const trips = [];
  for (const l of loads) trips.push(await loadSummary(l));
  const day = trips.filter((t) => t.started_at >= from && t.started_at < to);
  return {
    now: { loading: trips.filter((t) => t.state === 'loading').length, on_the_road: trips.filter((t) => t.state === 'on_the_road').length },
    day: {
      cars: day.length,
      seats_booked: day.reduce((n, t) => n + t.seats_booked, 0),
      paid_bookings: day.reduce((n, t) => n + t.paid_bookings, 0),
      booking_money: day.reduce((n, t) => n + t.booking_money, 0),
    },
    trips,
  };
}

/** One car's loading/trip: where it is, every booking on it (with how it was paid) and the parcels it carried. */
export async function officeTrip(loadId) {
  const l = await db.get(`${LOAD_SELECT} WHERE l.id = ?`, loadId);
  if (!l) throw notFound('Trip');
  const rows = await db.all(`${BOOKING_SELECT} WHERE b.load_id = ? ORDER BY b.id`, loadId);
  const parcels = await db.all(
    `SELECT p.id, p.tracking_code, p.status, p.receiver_name, s.name AS stop_name, p.loaded_at, p.arrived_at, p.collected_at
     FROM parcels p JOIN route_stops s ON s.id = p.stop_id WHERE p.load_id = ? ORDER BY p.id`,
    loadId,
  );
  return {
    ...(await loadSummary(l)),
    stops: (await tripStops(l)).map((s) => ({ name: s.name, reached_at: s.reached_at })),
    bookings: rows
      .map((b) => ({ b, status: statusOf(b) }))
      .filter(({ status }) => status !== 'failed')
      .map(({ b, status }) => ({
        id: b.id,
        code: b.code,
        status,
        seats: b.seats,
        amount: b.amount,
        paid_with: b.mpesa_payment_id ? 'mpesa' : 'wallet',
        stop_name: b.stop_name,
        passenger_name: b.passenger_name,
        passenger_phone: b.passenger_phone,
        booked_at: b.created_at,
        boarded_at: b.boarded_at,
        trip_id: b.paid_trip_id,
      })),
    parcels,
  };
}

// ---------- Crew (the conductor's app) ----------

const openLoad = (vehicleId) => db.get("SELECT * FROM loads WHERE vehicle_id = ? AND status = 'loading'", vehicleId);

// The car's last trip that left the stage and has not been marked finished.
const onRoad = (vehicleId) =>
  db.get("SELECT * FROM loads WHERE vehicle_id = ? AND status = 'departed' AND finished_at IS NULL ORDER BY departed_at DESC, id DESC LIMIT 1", vehicleId);

/** Every booking on a load that is paid or being paid, as the crew see it (a paid one on the road shows as paid). */
async function crewBookings(loadId) {
  const rows = await db.all(`${BOOKING_SELECT} WHERE b.load_id = ? ORDER BY b.id`, loadId);
  return rows
    .map((b) => ({ b, status: statusOf(b) === 'departed' ? 'confirmed' : statusOf(b) }))
    .filter(({ status }) => ['paying', 'confirmed', 'boarded'].includes(status))
    .map(({ b, status }) => ({
      id: b.id,
      code: b.code,
      status,
      seats: b.seats,
      amount: b.amount,
      stop_name: b.stop_name,
      passenger_name: b.passenger_name,
      passenger_phone: maskPhone(b.passenger_phone),
      booked_at: b.created_at,
      boarded_at: b.boarded_at,
    }));
}

/**
 * What the crew see: the car loading at the stage (or null) with its bookings, and the trip on the road (or null)
 * with the route's stops to tick off as the car reaches them, and who gets off where.
 */
export async function crewLoad(vehicle) {
  const load = await openLoad(vehicle.id);
  const road = await onRoad(vehicle.id);
  const taken = load ? await seatsTaken(load.id) : 0;
  return {
    loading: load ? { id: load.id, started_at: load.started_at, seats: load.seats, seats_booked: taken, seats_left: Math.max(0, load.seats - taken) } : null,
    vehicle_seats: vehicle.seats,
    bookings: load ? await crewBookings(load.id) : [],
    on_road: road
      ? {
          id: road.id,
          departed_at: road.departed_at,
          stops: (await tripStops(road)).map((s) => ({ id: s.id, name: s.name, reached_at: s.reached_at })),
          bookings: await crewBookings(road.id),
        }
      : null,
  };
}

/** The car is at the stage: start taking bookings for its route. */
export async function startLoading(vehicle, userId) {
  if (!vehicle.route_id) throw new HttpError(409, 'NO_ROUTE', 'This vehicle has no route set yet. Ask the SACCO office.');
  const route = await getRoute(vehicle.route_id);
  if (!route?.is_active || route.stops.length === 0) throw new HttpError(409, 'NO_ROUTE', 'This vehicle has no route in use. Ask the SACCO office.');
  await tx(async () => {
    if (await openLoad(vehicle.id)) throw new HttpError(409, 'ALREADY_LOADING', 'This car is already taking bookings.');
    // Back at a stage: the last trip is over, even if nobody marked it.
    await db.run(`UPDATE loads SET finished_at = ${NOW} WHERE vehicle_id = ? AND status = 'departed' AND finished_at IS NULL`, vehicle.id);
    await db.insert('INSERT INTO loads (vehicle_id, route_id, seats, started_by) VALUES (?, ?, ?, ?)', vehicle.id, route.id, vehicle.seats, userId);
  });
  return crewLoad(vehicle);
}

/** The car has left the stage: no more bookings on it. */
export async function departLoad(vehicle) {
  const done = await db.run(`UPDATE loads SET status = 'departed', departed_at = ${NOW} WHERE vehicle_id = ? AND status = 'loading'`, vehicle.id);
  if (!done.changes) throw new HttpError(409, 'NOT_LOADING', 'This car is not taking bookings.');
  return crewLoad(vehicle);
}

/** A booked passenger got on (ticked at the stage, or just after leaving). */
export async function boardBooking(vehicle, bookingId) {
  const loadIds = [await openLoad(vehicle.id), await onRoad(vehicle.id)].filter(Boolean).map((l) => l.id);
  const b = await db.get(`${BOOKING_SELECT} WHERE b.id = ?`, bookingId);
  if (!b || !loadIds.includes(b.load_id)) throw notFound('Booking');
  if (!['confirmed', 'departed'].includes(statusOf(b))) throw new HttpError(409, 'NOT_PAID', 'Only a paid booking can board.');
  await db.run(`UPDATE bookings SET boarded_at = ${NOW} WHERE id = ? AND boarded_at IS NULL`, bookingId);
  return crewLoad(vehicle);
}

/** The car on the road reached a stop on its route. Ticking it again changes nothing. */
export async function reachStop(vehicle, stopId) {
  const road = await onRoad(vehicle.id);
  if (!road) throw new HttpError(409, 'NOT_ON_ROAD', 'Mark the car as left the stage first.');
  const stop = await db.get('SELECT id FROM route_stops WHERE id = ? AND route_id = ?', stopId, road.route_id);
  if (!stop) throw notFound('Stop');
  await db.run('INSERT INTO load_stops (load_id, stop_id) VALUES (?, ?) ON CONFLICT DO NOTHING', road.id, stop.id);
  // Parcels on this car for this stop are there now.
  await db.run(`UPDATE parcels SET status = 'arrived', arrived_at = ${NOW} WHERE vehicle_id = ? AND stop_id = ? AND status = 'on_the_way'`, vehicle.id, stop.id);
  return crewLoad(vehicle);
}

/** The trip is over (the car is free to load again). */
export async function finishTrip(vehicle) {
  const done = await db.run(`UPDATE loads SET finished_at = ${NOW} WHERE vehicle_id = ? AND status = 'departed' AND finished_at IS NULL`, vehicle.id);
  if (!done.changes) throw new HttpError(409, 'NOT_ON_ROAD', 'There is no trip on the road to finish.');
  return crewLoad(vehicle);
}

/** Whether a car is taking bookings (its route can't change meanwhile). */
export const isLoading = async (vehicleId) => Boolean(await openLoad(vehicleId));
