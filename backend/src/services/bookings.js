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
import { refundTrip } from './trips.js';

export const MAX_SEATS_PER_BOOKING = 10;
const TOKEN_AUDIENCE = 'farepay-booking';

// Seats a booking holds: while its PIN prompt waits for an answer, and once paid (until refunded).
// A failed or cancelled payment frees them straight away.
const HOLDS_SEATS = `(p.status IN ('initiating', 'pending') OR (p.status = 'completed' AND t.status = 'paid'))`;

async function seatsTaken(loadId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(b.seats), 0) AS taken FROM bookings b
     JOIN mpesa_payments p ON p.id = b.mpesa_payment_id LEFT JOIN trips t ON t.id = p.trip_id
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
 * Books `seats` seats to `stopId` on the first car loading on the route with that many seats left, and sends the
 * M-Pesa PIN prompt for them. The seats are held while the prompt waits, and kept once paid. The same confirmation
 * sent twice (idempotencyKey) returns the first booking and sends no second prompt.
 */
export async function startBooking({ routeId, stopId, seats, expectedFare, phone, idempotencyKey }) {
  requireMpesa();
  await applyDueFareChanges();
  const passengerId = await passengerFor(phone);
  const previous = await db.get('SELECT id FROM bookings WHERE passenger_id = ? AND idempotency_key = ?', passengerId, idempotencyKey);
  if (previous) return { booking_token: tokenFor(previous.id), ...(await bookingStatus(previous.id)) };

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
  await sendPrompt(created.paymentId, {
    phone,
    amount: created.amount,
    accountReference: created.plate.replace(/\W/g, ''),
    description: 'Seat booking',
  });
  return { booking_token: tokenFor(created.bookingId), ...(await bookingStatus(created.bookingId)) };
}

const BOOKING_SELECT = `
  SELECT b.*, l.status AS car_status, l.vehicle_id, l.route_id, l.started_at AS loading_since, l.departed_at,
         v.plate, v.description AS vehicle_description, r.name AS route_name, r.origin, s.name AS stop_name,
         p.status AS payment_status, p.result_desc, p.trip_id, t.status AS trip_status,
         u.name AS passenger_name, u.phone AS passenger_phone
  FROM bookings b
  JOIN loads l ON l.id = b.load_id
  JOIN vehicles v ON v.id = l.vehicle_id
  JOIN routes r ON r.id = l.route_id
  JOIN route_stops s ON s.id = b.stop_id
  JOIN users u ON u.id = b.passenger_id
  LEFT JOIN mpesa_payments p ON p.id = b.mpesa_payment_id
  LEFT JOIN trips t ON t.id = p.trip_id`;

/** paying | confirmed | boarded | departed | cancelled | failed | paid_late */
function statusOf(b) {
  if (b.payment_status === 'initiating' || b.payment_status === 'pending') return 'paying';
  if (b.payment_status === 'failed') return 'failed';
  if (!b.trip_id) return 'paid_late'; // M-Pesa confirmed after FarePay gave up waiting: the money went to the wallet
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
      cars_ahead: ahead,
    },
    can_cancel: status === 'confirmed',
  };
}

export const bookingStatusByToken = (token) => bookingStatus(bookingIdFrom(token));

/** The passenger cancels before boarding, while the car is still at the stage: the money goes back to their FarePay wallet. */
export async function cancelBooking(token) {
  const bookingId = bookingIdFrom(token);
  const b = await db.get(`${BOOKING_SELECT} WHERE b.id = ?`, bookingId);
  if (!b) throw notFound('Booking');
  if (statusOf(b) !== 'confirmed') {
    throw new HttpError(409, 'CANNOT_CANCEL', 'This booking can no longer be cancelled (it is not paid, the passenger has boarded, or the car has left).');
  }
  await refundTrip(b.trip_id, `Seat booking ${b.code} cancelled by the passenger`);
  return bookingStatus(bookingId);
}

// ---------- Crew (the conductor's app) ----------

const openLoad = (vehicleId) => db.get("SELECT * FROM loads WHERE vehicle_id = ? AND status = 'loading'", vehicleId);

/** The car's current loading (or null), its seats, and every booking on it that is paid or being paid. */
export async function crewLoad(vehicle) {
  const load = await openLoad(vehicle.id);
  if (!load) return { loading: null, vehicle_seats: vehicle.seats };
  const rows = await db.all(`${BOOKING_SELECT} WHERE b.load_id = ? ORDER BY b.id`, load.id);
  const bookings = rows
    .map((b) => ({ b, status: statusOf(b) }))
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
  const taken = await seatsTaken(load.id);
  return {
    loading: { id: load.id, started_at: load.started_at, seats: load.seats, seats_booked: taken, seats_left: Math.max(0, load.seats - taken) },
    vehicle_seats: vehicle.seats,
    bookings,
  };
}

/** The car is at the stage: start taking bookings for its route. */
export async function startLoading(vehicle, userId) {
  if (!vehicle.route_id) throw new HttpError(409, 'NO_ROUTE', 'This vehicle has no route set yet. Ask the SACCO office.');
  const route = await getRoute(vehicle.route_id);
  if (!route?.is_active || route.stops.length === 0) throw new HttpError(409, 'NO_ROUTE', 'This vehicle has no route in use. Ask the SACCO office.');
  await tx(async () => {
    if (await openLoad(vehicle.id)) throw new HttpError(409, 'ALREADY_LOADING', 'This car is already taking bookings.');
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

/** A booked passenger got on. */
export async function boardBooking(vehicle, bookingId) {
  const load = await openLoad(vehicle.id);
  const b = load && (await db.get(`${BOOKING_SELECT} WHERE b.id = ? AND b.load_id = ?`, bookingId, load.id));
  if (!b) throw notFound('Booking');
  if (statusOf(b) !== 'confirmed') throw new HttpError(409, 'NOT_PAID', 'Only a paid booking can board.');
  await db.run(`UPDATE bookings SET boarded_at = ${NOW} WHERE id = ? AND boarded_at IS NULL`, bookingId);
  return crewLoad(vehicle);
}

/** Whether a car is taking bookings (its route can't change meanwhile). */
export const isLoading = async (vehicleId) => Boolean(await openLoad(vehicleId));
