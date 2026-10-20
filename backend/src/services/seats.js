// Seat booking from anywhere. A passenger pays for seats on a route (to their drop-off) and is either queued at the
// route's stage, or waits at a stop on the road to be picked. When a car reaches the stage, the stage marshal says so
// and the car is filled from the stage queue, first booked first served; the marshal gives road pickups to a car
// with free seats, and its crew are told whom to pick where. Nobody is given a car before it is really there.
//
// The money is exact and always accounted for: the price is fare × seats from the fare table, the M-Pesa prompt asks
// for exactly that, and M-Pesa's answer must match it. Paid money is held in the passenger's wallet history
// (booking_hold) until they board; then it is released and paid as one fare on the car they boarded (so that car's
// owner is paid). A cancelled booking is released and refunded: to M-Pesa if paid by M-Pesa, to the wallet if paid
// from it. A booking is for now, or for later today or tomorrow: the passenger says when they will be ready, and it joins
// the queue only at that time (ahead of anyone who chose a later time). Anything not on a car at the cutoff is refunded
// (tomorrow's bookings wait for tomorrow).
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiToday, randomCode } from '../util.js';
import { departLoad, isLoading, startLoading, typicalMinutes } from './bookings.js';
import { runDaily } from './jobs.js';
import { kesText, notify, notifyOffice } from './notifications.js';
import { getPayment, refreshPayment, requireMpesa, sendPrompt } from './payments.js';
import { applyDueFareChanges, getRoute, listRoutes, requireActiveStop } from './routes.js';
import { queueSms } from './sms.js';
import { afterPaidRide, creditFreeRide, nextRideIsFree, reverseFreeRide } from './rewards.js';
import { recordTrip } from './trips.js';
import { NO_APP_PASSWORD } from './users.js';
import { createWithdrawal, dispatchWithdrawal } from './withdrawals.js';
import { postWalletEntry } from './wallet.js';

export const MAX_SEATS = 10;
const OPEN = ['queued', 'assigned'];
const seatWord = (n) => `${n} seat${n === 1 ? '' : 's'}`;
// A booking's time has come (it is in the queue, not booked for later). col: its queued_at column.
const due = (col = 'queued_at') => `${col} <= ${NOW}`;
// Only a booking with a chosen time can be for later. (The database's clock and this server's can differ a little,
// so a booking for now, put in the queue at the database's "now", is never taken for later; 1 s allowed for that.)
const isLater = (b) => b.status === 'queued' && Boolean(b.ready_at) && Date.parse(b.queued_at) > Date.now() + 1000;
// A booking for later must be ready this long before the cutoff, so a car can still take it that day.
const LATER_LAST_BEFORE_CUTOFF_MIN = 30;
// The passenger is reminded this long before their time (only if they booked well before it).
const REMIND_BEFORE_MIN = 30;

// ---------- Reading ----------

const SEAT_SELECT = `
  SELECT sb.*, r.name AS route_name, r.origin, s.name AS stop_name, s.position AS stop_position,
         ps.name AS pickup_name, ps.position AS pickup_position,
         l.vehicle_id, l.status AS car_status, l.departed_at, l.finished_at, v.plate, v.description AS vehicle_description,
         dr.name AS driver_name, dr.phone AS driver_phone, co.name AS conductor_name, co.phone AS conductor_phone,
         u.name AS passenger_name, u.phone AS passenger_phone, u.password_hash = '${NO_APP_PASSWORD}' AS no_app,
         p.status AS payment_status, p.result_desc
  FROM seat_bookings sb
  JOIN routes r ON r.id = sb.route_id
  JOIN route_stops s ON s.id = sb.stop_id
  LEFT JOIN route_stops ps ON ps.id = sb.pickup_stop_id
  LEFT JOIN loads l ON l.id = sb.load_id
  LEFT JOIN vehicles v ON v.id = l.vehicle_id
  LEFT JOIN users dr ON dr.id = v.driver_id
  LEFT JOIN users co ON co.id = v.conductor_id
  JOIN users u ON u.id = sb.passenger_id
  LEFT JOIN mpesa_payments p ON p.id = sb.mpesa_payment_id`;

const getRow = (bookingId) => db.get(`${SEAT_SELECT} WHERE sb.id = ?`, bookingId);

// ---------- Where the cars are ----------

// A position older than this is not shown (the phone stopped sharing).
const LOCATION_FRESH_MS = 10 * 60_000;

/** A car's latest position from its crew's phone (null if none in the last 10 minutes). */
export async function carLocation(vehicleId) {
  const l = vehicleId ? await db.get('SELECT * FROM vehicle_locations WHERE vehicle_id = ?', vehicleId) : null;
  if (!l || Date.now() - Date.parse(l.recorded_at) > LOCATION_FRESH_MS) return null;
  return { lat: l.lat, lng: l.lng, heading: l.heading, speed: l.speed, at: l.recorded_at };
}

/**
 * The crew's phone says where the car is. Kept only while the car is on a trip (loading at the stage, or on the road
 * and not finished), so nobody is followed after work. Returns whether it was kept.
 */
export async function saveCarLocation(vehicleId, { lat, lng, heading = null, speed = null, accuracy = null }) {
  const onTrip = await db.get(
    "SELECT 1 FROM loads WHERE vehicle_id = ? AND (status = 'loading' OR (status = 'departed' AND finished_at IS NULL))",
    vehicleId,
  );
  if (!onTrip) return false;
  await db.run(
    `INSERT INTO vehicle_locations (vehicle_id, lat, lng, heading, speed, accuracy, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ${NOW})
     ON CONFLICT (vehicle_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, heading = excluded.heading,
       speed = excluded.speed, accuracy = excluded.accuracy, recorded_at = excluded.recorded_at`,
    vehicleId,
    lat,
    lng,
    heading,
    speed,
    accuracy,
  );
  return true;
}

/** Where the passenger is picked, in words. */
const pickupPlace = (b) => b.pickup_name ?? `${b.origin} stage`;

/** How many are before this booking in its stage queue (0 = next), or null when it isn't waiting at the stage. */
async function placeInQueue(b) {
  if (b.status !== 'queued' || b.pickup_stop_id || isLater(b)) return null;
  return (
    await db.get(
      `SELECT COUNT(*) AS n FROM seat_bookings WHERE route_id = ? AND status = 'queued' AND pickup_stop_id IS NULL AND ${due()}
       AND (queued_at < ? OR (queued_at = ? AND id < ?))`,
      b.route_id,
      b.queued_at,
      b.queued_at,
      b.id,
    )
  ).n;
}

/**
 * A booking as its passenger sees it. A booking whose M-Pesa payment is still waiting asks M-Pesa first; one whose
 * payment failed (or expired) is marked failed.
 */
export async function seatView(bookingId) {
  let b = await getRow(bookingId);
  if (!b) throw notFound('Booking');
  if (b.status === 'paying') {
    const payment = await getPayment(b.mpesa_payment_id);
    if (payment) await refreshPayment(payment);
    await failIfPaymentFailed(bookingId);
    b = await getRow(bookingId);
  }
  const assigned = b.status === 'assigned' || b.status === 'boarded';
  // A road pickup's car on the way: when it usually reaches the pickup, from past trips.
  const minutes =
    b.status === 'assigned' && b.pickup_stop_id && b.car_status === 'departed' && !b.finished_at ? await typicalMinutes(b.pickup_stop_id) : null;
  return {
    id: b.id,
    code: b.code,
    status: b.status, // paying | queued | assigned | boarded | cancelled | failed
    route: { id: b.route_id, name: b.route_name, origin: b.origin },
    pickup: { stop_id: b.pickup_stop_id, name: pickupPlace(b), at_stage: !b.pickup_stop_id },
    stop_name: b.stop_name,
    seats: b.seats,
    fare_each: b.fare_each,
    amount: b.amount,
    pay_with: b.pay_with,
    booked_at: b.created_at,
    // Booked for later: when they will be ready (they join the queue then); later = that time hasn't come yet.
    ready_at: b.ready_at,
    later: isLater(b),
    place_in_queue: await placeInQueue(b),
    passenger_here_at: b.passenger_here_at,
    car: assigned
      ? {
          plate: b.plate,
          description: b.vehicle_description,
          status: b.finished_at ? 'finished' : b.car_status, // loading (at the stage) | departed | finished
          departed_at: b.departed_at,
          driver: b.driver_name ? { name: b.driver_name, phone: b.driver_phone } : null,
          conductor: b.conductor_name ? { name: b.conductor_name, phone: b.conductor_phone } : null,
          // Only while the passenger is waiting for it.
          location: b.status === 'assigned' ? await carLocation(b.vehicle_id) : null,
          expected_at_pickup: minutes === null ? null : new Date(Date.parse(b.departed_at) + minutes * 60_000).toISOString(),
        }
      : null,
    assigned_at: b.assigned_at,
    boarded_at: b.boarded_at,
    trip_id: b.trip_id,
    reason: b.status === 'failed' ? b.result_desc : b.status === 'cancelled' ? b.cancel_reason : null,
    refund_to: b.refund_to,
    can_cancel: OPEN.includes(b.status),
    free_ride: Boolean(b.free_ride),
  };
}

async function failIfPaymentFailed(bookingId) {
  await db.run(
    `UPDATE seat_bookings SET status = 'failed' WHERE id = ? AND status = 'paying'
     AND EXISTS (SELECT 1 FROM mpesa_payments p WHERE p.id = seat_bookings.mpesa_payment_id AND p.status = 'failed')`,
    bookingId,
  );
}

// ---------- Booking and paying ----------

/** Minutes since midnight in Kenya, now. */
const nairobiMinutes = () => {
  const d = new Date(Date.now() + 3 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A time's Kenyan date (YYYY-MM-DD) and minutes since midnight. */
const nairobiParts = (ms) => {
  const d = new Date(ms + 3 * 3600_000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const nairobiTomorrow = () => nairobiParts(Date.now() + 86_400_000).date;

/** The latest "ready from" time a booking for later can choose (e.g. 21:30 with a 22:00 cutoff). */
const lastReadyTime = () => hhmm(toMinutes(config.seatBookingCutoff) - LATER_LAST_BEFORE_CUTOFF_MIN);

/** "today at 17:30" / "tomorrow at 06:00", in Kenyan time. */
export function whenText(iso) {
  const { date, minutes } = nairobiParts(Date.parse(iso));
  const day = date === nairobiToday() ? 'today' : date === nairobiTomorrow() ? 'tomorrow' : date;
  return `${day} at ${hhmm(minutes)}`;
}

/**
 * The "ready from" time of a booking for later, checked: today or tomorrow, between opening and a little before the
 * cutoff. Null (ready now) when none is given or it is within a few minutes from now.
 */
function laterTime(readyAt) {
  if (readyAt === null || readyAt === undefined) return null;
  const ms = Math.floor(Date.parse(readyAt) / 60_000) * 60_000;
  if (Number.isNaN(ms)) throw new HttpError(400, 'BAD_TIME', 'Choose when you will be ready.');
  if (ms <= Date.now() + 5 * 60_000) return null;
  const { date, minutes } = nairobiParts(ms);
  if (date !== nairobiToday() && date !== nairobiTomorrow()) throw new HttpError(400, 'TOO_FAR_AHEAD', 'You can book for today or tomorrow only.');
  const opens = toMinutes(config.seatBookingOpens);
  const last = toMinutes(config.seatBookingCutoff) - LATER_LAST_BEFORE_CUTOFF_MIN;
  if (opens < last && (minutes < opens || minutes > last)) {
    throw new HttpError(400, 'BAD_TIME', `Choose a time between ${config.seatBookingOpens} and ${hhmm(last)}.`);
  }
  return new Date(ms).toISOString();
}

/** Seat booking is closed from the cutoff (e.g. 22:00) until it opens (e.g. 04:00). */
export function bookingClosed() {
  const now = nairobiMinutes();
  const cutoff = toMinutes(config.seatBookingCutoff);
  const opens = toMinutes(config.seatBookingOpens);
  return cutoff > opens ? now >= cutoff || now < opens : now >= cutoff && now < opens;
}

/** Routes passengers can book on: stops in order with fares, and how many seats are waiting at the stage. */
export async function seatRoutes() {
  const routes = await listRoutes({ activeOnly: true });
  const result = [];
  for (const r of routes) {
    const waiting = await db.get(
      `SELECT COALESCE(SUM(seats), 0) AS n FROM seat_bookings WHERE route_id = ? AND status = 'queued' AND pickup_stop_id IS NULL AND ${due()}`,
      r.id,
    );
    const loading = await db.get("SELECT COUNT(*) AS n FROM loads WHERE route_id = ? AND status = 'loading'", r.id);
    result.push({
      id: r.id,
      name: r.name,
      origin: r.origin,
      stops: r.stops.map((s) => ({ id: s.id, name: s.name, fare: s.app_fare, position: s.position })),
      seats_waiting: waiting.n,
      cars_loading: loading.n,
    });
  }
  return {
    open: !bookingClosed(),
    opens_at: config.seatBookingOpens,
    closes_at: config.seatBookingCutoff,
    // Booking for later: a "ready from" time today or tomorrow, from opens_at to last_ready_at (Kenyan time).
    later: { today: nairobiToday(), tomorrow: nairobiTomorrow(), last_ready_at: lastReadyTime() },
    routes: result,
  };
}

async function uniqueCode() {
  for (;;) {
    const code = randomCode(6);
    if (!(await db.get('SELECT 1 FROM seat_bookings WHERE code = ? UNION ALL SELECT 1 FROM bookings WHERE code = ?', code, code))) return code;
  }
}

/**
 * Books `seats` seats on a route to `stopId`, picked at the stage (pickupStopId null) or at a stop on the road before
 * the drop-off. The price is the drop-off's fare (the full fare from the stage, wherever they are picked) × seats,
 * and must equal what the passenger was shown (`expectedFare` per seat). Paid by M-Pesa PIN prompt, or from the
 * passenger's FarePay wallet at once. The same confirmation sent twice (idempotencyKey) returns the first booking.
 */
export async function bookSeats({ passengerId, phone, routeId, pickupStopId = null, stopId, seats, expectedFare, idempotencyKey, payWith, readyAt = null }) {
  const previous = await db.get('SELECT id FROM seat_bookings WHERE passenger_id = ? AND idempotency_key = ?', passengerId, idempotencyKey);
  if (previous) return seatView(previous.id);
  const later = laterTime(readyAt);
  if (!later && bookingClosed()) {
    throw new HttpError(409, 'BOOKING_CLOSED', `Seat booking is closed for today. It opens again at ${config.seatBookingOpens}, or book for tomorrow.`);
  }
  if (payWith === 'mpesa') requireMpesa();
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) throw new HttpError(400, 'BAD_SEATS', `Book 1 to ${MAX_SEATS} seats.`);
  await applyDueFareChanges();
  const route = await getRoute(routeId);
  if (!route || !route.is_active) throw notFound('Route');

  const created = await tx(async () => {
    const stop = await requireActiveStop(routeId, stopId);
    if (pickupStopId !== null) {
      const pickup = await requireActiveStop(routeId, pickupStopId);
      if (pickup.position >= stop.position || pickup.id === stop.id) {
        throw new HttpError(400, 'PICKUP_AFTER_DROPOFF', 'Choose a pickup point before your drop-off on this route.');
      }
    }
    if (stop.app_fare !== expectedFare) {
      throw new HttpError(409, 'FARE_CHANGED', `The fare to ${stop.name} is now ${kesText(stop.app_fare)}. Please check and book again.`, { fare: stop.app_fare });
    }
    const open = (await db.get("SELECT COUNT(*) AS n FROM seat_bookings WHERE passenger_id = ? AND status IN ('paying', 'queued', 'assigned')", passengerId)).n;
    if (open >= config.maxOpenSeatBookings) {
      throw new HttpError(429, 'TOO_MANY_BOOKINGS', `You already have ${open} bookings waiting. Use or cancel one before booking again.`);
    }
    const amount = stop.app_fare * seats;
    const code = await uniqueCode();
    // Loyalty: a one-seat booking can be the passenger's free ride (the SACCO pays it; nothing is charged).
    const free = seats === 1 && (await nextRideIsFree(passengerId));
    if (free) {
      const bookingId = await db.insert(
        `INSERT INTO seat_bookings (code, passenger_id, route_id, pickup_stop_id, stop_id, seats, fare_each, amount, pay_with, status, ready_at, queued_at, idempotency_key, free_ride)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wallet', 'queued', ?, COALESCE(?, ${NOW}), ?, TRUE)`,
        code,
        passengerId,
        routeId,
        pickupStopId,
        stop.id,
        seats,
        stop.app_fare,
        amount,
        later,
        later,
        idempotencyKey,
      );
      await creditFreeRide(passengerId, amount, code);
      await postWalletEntry(passengerId, { type: 'booking_hold', amount: -amount, reference: code, description: holdText(seats, route, stop) });
      await afterQueued(bookingId);
      return { bookingId };
    }
    if (payWith === 'wallet') {
      const bookingId = await db.insert(
        `INSERT INTO seat_bookings (code, passenger_id, route_id, pickup_stop_id, stop_id, seats, fare_each, amount, pay_with, status, ready_at, queued_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wallet', 'queued', ?, COALESCE(?, ${NOW}), ?)`,
        code,
        passengerId,
        routeId,
        pickupStopId,
        stop.id,
        seats,
        stop.app_fare,
        amount,
        later,
        later,
        idempotencyKey,
      );
      // Refused (and everything undone) if the wallet is short.
      await postWalletEntry(passengerId, { type: 'booking_hold', amount: -amount, reference: code, description: holdText(seats, route, stop) });
      await afterQueued(bookingId);
      return { bookingId };
    }
    // Recorded before the prompt is sent, so a fast confirmation always finds it.
    const paymentId = await db.insert(
      `INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, stop_id, idempotency_key)
       VALUES (?, ?, ?, 'seat', 'initiating', ?, ?)`,
      passengerId,
      phone,
      amount,
      stop.id,
      `seat-${idempotencyKey}`,
    );
    const bookingId = await db.insert(
      `INSERT INTO seat_bookings (code, passenger_id, route_id, pickup_stop_id, stop_id, seats, fare_each, amount, pay_with, mpesa_payment_id, status, ready_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mpesa', ?, 'paying', ?, ?)`,
      code,
      passengerId,
      routeId,
      pickupStopId,
      stop.id,
      seats,
      stop.app_fare,
      amount,
      paymentId,
      later,
      idempotencyKey,
    );
    return { bookingId, paymentId, amount, code };
  });
  if (created.paymentId) {
    await sendPrompt(created.paymentId, { phone, amount: created.amount, accountReference: created.code, description: 'Seat booking' });
  }
  return seatView(created.bookingId);
}

const holdText = (seats, route, stop) => `Seat booking: ${seatWord(seats)}, ${route.name} to ${stop.name} (held until you board)`;

/**
 * M-Pesa confirmed a seat booking's payment (called inside the confirmation's transaction). The money goes into the
 * wallet history and straight into the booking's hold, and the booking joins the queue. If M-Pesa says a different
 * amount was paid, the passenger is not seated: what they paid goes to their wallet and the office is told.
 */
export async function seatPaymentConfirmed(payment, receipt, paidAmount) {
  const b = await db.get('SELECT * FROM seat_bookings WHERE mpesa_payment_id = ?', payment.id);
  if (!b) return;
  const reference = receipt ?? `MPESA-${payment.id}`;
  if (paidAmount !== null && paidAmount !== b.amount) {
    await db.run('UPDATE mpesa_payments SET amount = ?, result_desc = ? WHERE id = ?', paidAmount, `Paid ${paidAmount}, booking was ${b.amount}`, payment.id);
    await postWalletEntry(b.passenger_id, { type: 'topup', amount: paidAmount, reference, description: 'M-Pesa payment for a seat booking (wrong amount): added to your wallet' });
    await db.run("UPDATE seat_bookings SET status = 'failed' WHERE id = ?", b.id);
    await notify([b.passenger_id], {
      kind: 'seat.failed',
      title: 'Seat booking not made',
      body: `M-Pesa took ${kesText(paidAmount)} but the booking was ${kesText(b.amount)}, so the money is in your FarePay wallet.`,
      target: 'seats',
    });
    await notifyOffice({ kind: 'seat.amount_mismatch', title: `Seat booking ${b.code}: M-Pesa amount did not match`, body: `Paid ${paidAmount}, expected ${b.amount}. Receipt ${reference}.`, target: 'reports' });
    return;
  }
  const route = await getRoute(b.route_id);
  const stop = await db.get('SELECT * FROM route_stops WHERE id = ?', b.stop_id);
  await postWalletEntry(b.passenger_id, { type: 'topup', amount: b.amount, reference, description: 'M-Pesa payment for a seat booking' });
  await postWalletEntry(b.passenger_id, { type: 'booking_hold', amount: -b.amount, reference: b.code, description: holdText(b.seats, route, stop) });
  // Booked for later: its place in the queue is its "ready from" time (unless that has already passed).
  const later = b.ready_at && Date.parse(b.ready_at) > Date.now() ? b.ready_at : null;
  await db.run(`UPDATE seat_bookings SET status = 'queued', queued_at = COALESCE(?, ${NOW}) WHERE id = ? AND status = 'paying'`, later, b.id);
  await afterQueued(b.id);
}

/** A seat booking's M-Pesa payment failed: nothing was taken. */
export async function seatPaymentFailed(payment, reason) {
  const b = await db.get("SELECT * FROM seat_bookings WHERE mpesa_payment_id = ? AND status = 'paying'", payment.id);
  if (!b) return;
  await db.run("UPDATE seat_bookings SET status = 'failed' WHERE id = ?", b.id);
  await notify([b.passenger_id], { kind: 'seat.failed', title: 'Seat booking not paid', body: `${reason}. No money was taken.`, target: 'seats' });
}

/** A booking was just paid: tell the passenger, and (unless it is for later) seat them at once if a car at the stage has room. */
async function afterQueued(bookingId) {
  const b = await getRow(bookingId);
  if (isLater(b)) {
    const when = whenText(b.queued_at);
    await tell(b, {
      kind: 'seat.queued',
      title: `Seat booked for ${when}: ${b.code}`,
      body: `${seatWord(b.seats)} to ${b.stop_name}, from ${pickupPlace(b)}. Be there ${when}: you join the queue then, ahead of anyone who chose a later time. We'll remind you before. Cancel free until then.`,
      sms: `Makos seat booked (${b.code}) for ${when}: ${seatWord(b.seats)} to ${b.stop_name}, from ${pickupPlace(b)}. We'll remind you before.`,
    });
    return;
  }
  if (b.pickup_stop_id) {
    await tell(b, {
      kind: 'seat.queued',
      title: `Seat booked: ${b.code}`,
      body: `${seatWord(b.seats)} to ${b.stop_name}, to be picked at ${b.pickup_name}. We'll tell you which car is coming and when.`,
      sms: `Makos seat booked (${b.code}): ${seatWord(b.seats)} to ${b.stop_name}, pickup at ${b.pickup_name}. We'll text you the car coming for you.`,
    });
  } else {
    const ahead = await placeInQueue(b);
    await tell(b, {
      kind: 'seat.queued',
      title: `Seat booked: ${b.code}`,
      body: `${seatWord(b.seats)} to ${b.stop_name}. You're ${ordinal(ahead + 1)} in the queue at ${b.origin} stage. We'll tell you which car to board.`,
      sms: `Makos seat booked (${b.code}): ${seatWord(b.seats)} to ${b.stop_name}. You're ${ordinal(ahead + 1)} in the queue at ${b.origin}. We'll text you the car to board.`,
    });
  }
  await joinedQueue(bookingId);
}

/**
 * A booking's time has come (just paid, or its "ready from" time reached): a stage booking is put on a car if one has
 * room, and the marshals are told (once) who joined their queue.
 */
async function joinedQueue(bookingId) {
  const before = await getRow(bookingId);
  if (!before.pickup_stop_id) await fillRoute(before.route_id);
  const b = await getRow(bookingId);
  const { changes } = await db.run(`UPDATE seat_bookings SET marshals_told_at = ${NOW} WHERE id = ? AND marshals_told_at IS NULL`, bookingId);
  if (!changes || !OPEN.includes(b.status)) return;
  const who = `${b.passenger_name}, code ${b.code}, going to ${b.stop_name}. Already paid.`;
  if (b.pickup_stop_id) {
    await tellMarshals({
      kind: 'seat.new',
      title: `Road pickup at ${b.pickup_name}: ${seatWord(b.seats)}`,
      body: b.status === 'assigned' ? `${who} On ${b.plate}.` : `${who} Give it a car going that way.`,
    });
  } else {
    await tellMarshals({
      kind: 'seat.new',
      title: `New in the ${b.origin} queue: ${seatWord(b.seats)}`,
      body: b.status === 'assigned' ? `${who} Put on ${b.plate}.` : `${who} ${ordinal((await placeInQueue(b)) + 1)} in the queue.`,
    });
  }
}

/**
 * Every minute: passengers booked for later are reminded shortly before their time, and when it comes they join the
 * queue (a car at the stage takes them if it has room; the marshals are told).
 */
export async function runSeatTimers() {
  const soon = new Date(Date.now() + REMIND_BEFORE_MIN * 60_000).toISOString();
  const toRemind = await db.all(
    `SELECT id FROM seat_bookings WHERE status = 'queued' AND ready_at IS NOT NULL AND reminded_at IS NULL AND queued_at > ${NOW} AND queued_at <= ?`,
    soon,
  );
  for (const { id } of toRemind) {
    const b = await getRow(id);
    await db.run(`UPDATE seat_bookings SET reminded_at = ${NOW} WHERE id = ?`, id);
    // Booked only a little before their time: they know already.
    if (Date.parse(b.created_at) > Date.parse(b.ready_at) - (REMIND_BEFORE_MIN + 15) * 60_000) continue;
    const time = hhmm(nairobiParts(Date.parse(b.ready_at)).minutes);
    await tell(b, {
      kind: 'seat.reminder',
      title: `Your seat is at ${time}: ${b.code}`,
      body: `Be at ${pickupPlace(b)} by ${time}. You join the queue then and we'll tell you which car. Can't make it? Cancel free before ${time}.`,
      sms: `Makos reminder: be at ${pickupPlace(b)} by ${time} for booking ${b.code} (${seatWord(b.seats)} to ${b.stop_name}). We'll text you the car.`,
    });
  }
  const nowDue = await db.all(
    `SELECT id FROM seat_bookings WHERE status = 'queued' AND ready_at IS NOT NULL AND marshals_told_at IS NULL AND ${due()} ORDER BY queued_at, id`,
  );
  for (const { id } of nowDue) {
    try {
      const b = await getRow(id);
      if (!b.pickup_stop_id) {
        const ahead = await placeInQueue(b);
        await tell(b, {
          kind: 'seat.in_queue',
          title: `You're in the queue: ${b.code}`,
          body: `You're ${ordinal(ahead + 1)} in the queue at ${b.origin} stage. We'll tell you which car to board.`,
          sms: `Makos: booking ${b.code}, you're ${ordinal(ahead + 1)} in the queue at ${b.origin}. We'll text you the car to board.`,
        });
      }
      await joinedQueue(id);
    } catch (err) {
      console.error(`[seat timers] booking ${id}:`, err.message);
    }
  }
  return { reminded: toRemind.length, joined: nowDue.length };
}

/** When runSeatTimers next has something to do (ms; null: nothing booked for later), so a quiet server can wait. */
export async function nextSeatTimerAt() {
  const row = await db.get(
    `SELECT MIN(CASE WHEN reminded_at IS NULL THEN queued_at END) AS remind, MIN(CASE WHEN marshals_told_at IS NULL THEN queued_at END) AS join_at
     FROM seat_bookings WHERE status = 'queued' AND ready_at IS NOT NULL`,
  );
  const times = [row?.remind && Date.parse(row.remind) - REMIND_BEFORE_MIN * 60_000, row?.join_at && Date.parse(row.join_at)].filter(Boolean);
  return times.length ? Math.min(...times) : null;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** Tells a passenger: in the app (and by push), and by SMS for passengers who booked without the app. */
async function tell(b, { kind, title, body, sms }) {
  await notify([b.passenger_id], { kind, title, body, target: 'seats' });
  if (b.no_app && sms) await queueSms(b.passenger_phone, kind, sms);
}

/** Tells the crew of a car (driver, and conductor on buses): in the app, and by SMS too when sms is given. */
async function tellCrew(vehicleId, { sms, ...message }) {
  const v = await db.get('SELECT driver_id, conductor_id FROM vehicles WHERE id = ?', vehicleId);
  const ids = [v?.driver_id, v?.conductor_id].filter(Boolean);
  if (!ids.length) return;
  await notify(ids, { ...message, target: 'seats' });
  if (!sms) return;
  for (const id of ids) {
    const crew = await db.get('SELECT phone FROM users WHERE id = ? AND is_active = TRUE', id);
    if (crew) await queueSms(crew.phone, message.kind, sms);
  }
}

const tellMarshals = async (message) => {
  const marshals = await db.all("SELECT id FROM users WHERE role = 'marshal' AND is_active = TRUE");
  await notify(
    marshals.map((m) => m.id),
    { ...message, target: 'queue' },
  );
};

// ---------- Cars and the queue ----------

/**
 * Seats on a car (load) already taken: seat bookings put on it, bookings made on it the old way, and passengers who
 * walked up and paid FarePay on it while it was loading (one seat each). A car marked full has none left, e.g. when
 * passengers paying cash filled it.
 */
export async function seatsTaken(loadId) {
  const load = await db.get('SELECT vehicle_id, seats, started_at, departed_at, full_at FROM loads WHERE id = ?', loadId);
  if (load?.full_at) return load.seats;
  const walkIns = load
    ? await db.get(
        `SELECT COUNT(*) AS n FROM trips t
         WHERE t.vehicle_id = ? AND t.status = 'paid' AND t.created_at >= ? AND (CAST(? AS TEXT) IS NULL OR t.created_at < ?)
           AND t.idempotency_key NOT LIKE 'seat-%'
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id)
           AND NOT EXISTS (SELECT 1 FROM mpesa_payments p JOIN bookings b ON b.mpesa_payment_id = p.id WHERE p.trip_id = t.id)`,
        load.vehicle_id,
        load.started_at,
        load.departed_at ?? null,
        load.departed_at ?? null,
      )
    : { n: 0 };
  const seat = await db.get("SELECT COALESCE(SUM(seats), 0) AS n FROM seat_bookings WHERE load_id = ? AND status IN ('assigned', 'boarded')", loadId);
  const old = await db.get(
    `SELECT COALESCE(SUM(b.seats), 0) AS n FROM bookings b
     LEFT JOIN mpesa_payments p ON p.id = b.mpesa_payment_id LEFT JOIN trips t ON t.id = COALESCE(b.trip_id, p.trip_id)
     WHERE b.load_id = ? AND (p.status IN ('initiating', 'pending') OR t.status = 'paid')`,
    loadId,
  );
  return Number(seat.n) + Number(old.n) + Number(walkIns.n);
}

/**
 * The marshal or crew say the loading car is full (no more passengers from the queue), or not full any more (it takes
 * the next in the queue again).
 */
export async function setCarFull(vehicleId, full) {
  const load = await db.get("SELECT id, route_id FROM loads WHERE vehicle_id = ? AND status = 'loading'", vehicleId);
  if (!load) throw new HttpError(409, 'NOT_LOADING', 'This car is not loading at the stage.');
  await db.run(`UPDATE loads SET full_at = ${full ? NOW : 'NULL'} WHERE id = ?`, load.id);
  if (!full) await fillRoute(load.route_id);
}

/**
 * Fills every car loading at a route's stage from its stage queue, first booked first served. A booking bigger
 * than the seats left waits (keeping its place) and the next one that fits goes on.
 */
export async function fillRoute(routeId) {
  return tx(async () => {
    const loads = await db.all("SELECT * FROM loads WHERE route_id = ? AND status = 'loading' ORDER BY started_at, id", routeId);
    for (const load of loads) {
      let left = load.seats - (await seatsTaken(load.id));
      if (left <= 0) continue;
      const queue = await db.all(
        `SELECT id, seats FROM seat_bookings WHERE route_id = ? AND status = 'queued' AND pickup_stop_id IS NULL AND ${due()} ORDER BY queued_at, id`,
        routeId,
      );
      for (const q of queue) {
        if (q.seats > left) continue;
        await assign(q.id, load);
        left -= q.seats;
        if (left === 0) break;
      }
    }
  });
}

async function assign(bookingId, load) {
  await db.run(`UPDATE seat_bookings SET status = 'assigned', load_id = ?, assigned_at = ${NOW} WHERE id = ?`, load.id, bookingId);
  const b = await getRow(bookingId);
  const car = `${b.plate}${b.vehicle_description ? ` (${b.vehicle_description})` : ''}`;
  if (b.pickup_stop_id) {
    await tell(b, {
      kind: 'seat.assigned',
      title: `${b.plate} is coming for you`,
      body: `Your car is ${car}. Wait at ${b.pickup_name}; we'll tell you when it leaves ${b.origin}. Show code ${b.code} when you board.`,
      sms: `Makos: ${b.plate} will pick you at ${b.pickup_name} (booking ${b.code}). We'll text you when it leaves ${b.origin}.`,
    });
    await tellCrew(load.vehicle_id, {
      kind: 'seat.pickup',
      title: `Pick ${seatWord(b.seats)} at ${b.pickup_name}`,
      body: `${b.passenger_name}, code ${b.code}, going to ${b.stop_name}. Already paid.`,
      sms: `Makos: pick ${seatWord(b.seats)} at ${b.pickup_name} for ${b.plate}: ${b.passenger_name}, code ${b.code}, to ${b.stop_name}. Already paid.`,
    });
  } else {
    await tell(b, {
      kind: 'seat.assigned',
      title: `Board ${b.plate} now`,
      body: `Your car is ${car} at ${b.origin} stage. Show code ${b.code} to the marshal when you board.`,
      sms: `Makos: board ${b.plate} now at ${b.origin} stage. Show code ${b.code}.`,
    });
  }
}

/** Unboarded passengers put on a car that has left the stage (or finished its trip) go back to the front of the queue. */
async function backToQueue(loadId, { stageOnly }) {
  const rows = await db.all(
    `SELECT id FROM seat_bookings WHERE load_id = ? AND status = 'assigned'${stageOnly ? ' AND pickup_stop_id IS NULL' : ''}`,
    loadId,
  );
  for (const { id } of rows) {
    const b = await getRow(id);
    await db.run("UPDATE seat_bookings SET status = 'queued', load_id = NULL, assigned_at = NULL WHERE id = ?", id);
    await tell(b, {
      kind: 'seat.missed',
      title: `${b.plate} left without you`,
      body: `Your booking ${b.code} is still paid and you are first in line for the next car${b.pickup_stop_id ? ` to pick you at ${b.pickup_name}` : ` at ${b.origin}`}.`,
      sms: `Makos: ${b.plate} left without you. Booking ${b.code} is still paid; you're first for the next car.`,
    });
  }
  return rows.length;
}

const getVehicle = (vehicleId) => db.get('SELECT * FROM vehicles WHERE id = ?', vehicleId);

/**
 * The marshal: a car has reached the stage and is loading. It takes the route given (or keeps its own), starts
 * loading, and is filled from the queue at once.
 */
export async function carArrived(vehicleId, routeId, marshalId) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle || !vehicle.is_active) throw notFound('Vehicle');
  if (routeId && routeId !== vehicle.route_id) {
    const route = await getRoute(routeId);
    if (!route?.is_active) throw notFound('Route');
    if (await isLoading(vehicle.id)) throw new HttpError(409, 'ALREADY_LOADING', `${vehicle.plate} is already loading.`);
    await db.run('UPDATE vehicles SET route_id = ? WHERE id = ?', routeId, vehicle.id);
    vehicle.route_id = routeId;
  }
  await startLoading(vehicle, marshalId);
  return vehicle;
}

/** The car left the stage: no one else gets on there; anyone put on it who didn't board goes back to the queue. */
export async function carLeft(vehicleId) {
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) throw notFound('Vehicle');
  await departLoad(vehicle);
}

/** Called when a car leaves the stage (whoever marks it): queue clean-up, and road pickups are told it is coming. */
export async function onDeparted(load) {
  await backToQueue(load.id, { stageOnly: true });
  const pickups = await db.all("SELECT id FROM seat_bookings WHERE load_id = ? AND status = 'assigned' AND pickup_stop_id IS NOT NULL", load.id);
  for (const { id } of pickups) {
    const b = await getRow(id);
    await tell(b, {
      kind: 'seat.on_the_way',
      title: `${b.plate} has left ${b.origin}`,
      body: `It is on the way to pick you at ${b.pickup_name}. Be ready with code ${b.code}.`,
      sms: `Makos: ${b.plate} has left ${b.origin} and is coming to ${b.pickup_name}. Booking ${b.code}.`,
    });
  }
  await fillRoute(load.route_id);
}

/** Called when a trip is over: pickups it never made go back to the queue (refunded instead after the cutoff). */
export async function onTripFinished(load) {
  if (bookingClosed()) {
    const rows = await db.all("SELECT id FROM seat_bookings WHERE load_id = ? AND status = 'assigned'", load.id);
    for (const { id } of rows) await cancelSeat(id, { reason: 'The car did not pick you up', by: 'system' });
    return;
  }
  if (await backToQueue(load.id, { stageOnly: false })) await fillRoute(load.route_id);
}

/** The marshal gives a road pickup to a car (at the stage, or already on the road but not yet past the pickup). */
export async function assignPickup(bookingId, loadId) {
  await tx(async () => {
    const b = await db.get('SELECT * FROM seat_bookings WHERE id = ?', bookingId);
    if (!b) throw notFound('Booking');
    if (b.status !== 'queued' || !b.pickup_stop_id) throw new HttpError(409, 'NOT_WAITING', 'This booking is not waiting to be picked on the road.');
    if (isLater(b)) throw new HttpError(409, 'NOT_YET', `This passenger is ready ${whenText(b.queued_at)}. Give them a car then.`);
    const load = await db.get('SELECT * FROM loads WHERE id = ?', loadId);
    if (!load || load.finished_at || load.route_id !== b.route_id) throw new HttpError(409, 'WRONG_CAR', 'Choose a car on this route that is loading or on the road.');
    const passed = await db.get('SELECT 1 FROM load_stops WHERE load_id = ? AND stop_id = ?', loadId, b.pickup_stop_id);
    if (passed) throw new HttpError(409, 'ALREADY_PASSED', 'That car has already passed the pickup point.');
    const left = load.seats - (await seatsTaken(load.id));
    if (left < b.seats) throw new HttpError(409, 'NOT_ENOUGH_SEATS', `That car has ${seatWord(Math.max(0, left))} left; this booking needs ${b.seats}.`);
    await assign(b.id, load);
    if (load.status === 'departed') {
      const row = await getRow(b.id);
      await tell(row, {
        kind: 'seat.on_the_way',
        title: `${row.plate} is on the way`,
        body: `It left ${row.origin} and will pick you at ${row.pickup_name}. Be ready with code ${row.code}.`,
        sms: `Makos: ${row.plate} is on the way to pick you at ${row.pickup_name}. Booking ${row.code}.`,
      });
    }
  });
  return seatView(bookingId);
}

/**
 * The passenger got on (ticked by the marshal at the stage, or by the car's crew on the road). Their held money is
 * released and paid as a fare on this car, so its owner is paid for it.
 */
export async function boardSeat(bookingId, { vehicleId = null } = {}) {
  await tx(async () => {
    const b = await getRow(bookingId);
    if (!b) throw notFound('Booking');
    if (vehicleId !== null && b.vehicle_id !== vehicleId) throw notFound('Booking');
    if (b.status === 'boarded') return;
    if (b.status !== 'assigned') throw new HttpError(409, 'NOT_ON_A_CAR', 'Only a booking put on this car can board.');
    const vehicle = await getVehicle(b.vehicle_id);
    const stop = await db.get('SELECT * FROM route_stops WHERE id = ?', b.stop_id);
    await postWalletEntry(b.passenger_id, { type: 'booking_release', amount: b.amount, reference: b.code, description: `Seat booking ${b.code}: boarded ${b.plate}` });
    const tripId = await recordTrip({ passengerId: b.passenger_id, vehicle, stop, fare: b.amount, idempotencyKey: `seat-${b.id}`, freeRide: Boolean(b.free_ride) });
    await db.run(`UPDATE seat_bookings SET status = 'boarded', boarded_at = ${NOW}, trip_id = ? WHERE id = ?`, tripId, b.id);
    if (!b.free_ride) await afterPaidRide(b.passenger_id);
    await notify([b.passenger_id], { kind: 'seat.boarded', title: `On board ${b.plate}`, body: `Have a good trip to ${b.stop_name}.`, target: 'seats' });
  });
  return seatView(bookingId);
}

/**
 * Boarding by scanning the QR on the passenger's booking screen (or typing its code): the marshal (any car) or the
 * crew (their own car only). Says who it is, so whoever scans can check them. Scanning twice is harmless.
 */
export async function boardByCode(rawCode, { vehicleId = null } = {}) {
  const code = String(rawCode ?? '').trim().toUpperCase().replace(/^FAREPAY-SEAT:/, '');
  const row = await db.get('SELECT id, status FROM seat_bookings WHERE code = ?', code);
  if (!row) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'No seat booking with this code.');
  const before = await getRow(row.id);
  if (before.status === 'queued') throw new HttpError(409, 'NOT_ON_A_CAR', `${before.passenger_name} (${before.code}) is still waiting in the queue: no car has been given to them yet.`);
  if (vehicleId !== null && before.vehicle_id !== vehicleId) {
    throw new HttpError(409, 'OTHER_CAR', before.plate ? `${before.passenger_name} (${before.code}) is booked on ${before.plate}, not this car.` : 'This booking is not on this car.');
  }
  if (before.status !== 'assigned' && before.status !== 'boarded') throw new HttpError(409, 'NOT_ON_A_CAR', `Booking ${before.code} is ${before.status}: it can't board.`);
  await boardSeat(row.id, { vehicleId });
  return {
    code: before.code,
    passenger_name: before.passenger_name,
    seats: before.seats,
    stop_name: before.stop_name,
    plate: before.plate,
    already_boarded: before.status === 'boarded',
  };
}

/** The passenger is at the pickup point: their car's crew (or, before a car is given, the marshals) are told. */
export async function passengerHere(bookingId) {
  const b = await getRow(bookingId);
  if (!b || !OPEN.includes(b.status)) throw new HttpError(409, 'NOT_WAITING', 'This booking is not waiting for a car.');
  await db.run(`UPDATE seat_bookings SET passenger_here_at = ${NOW} WHERE id = ?`, bookingId);
  const message = {
    kind: 'seat.here',
    title: `${b.passenger_name} is waiting at ${pickupPlace(b)}`,
    body: `Booking ${b.code}, ${seatWord(b.seats)} to ${b.stop_name}.`,
  };
  if (b.status === 'assigned') await tellCrew(b.vehicle_id, message);
  else await tellMarshals(message);
  return seatView(bookingId);
}

/**
 * Cancels a booking that hasn't boarded and refunds it: the held money is released, and (paid by M-Pesa) sent back
 * to the passenger's M-Pesa. If M-Pesa can't send it, it lands in their FarePay wallet; if M-Pesa gives no answer,
 * the office is asked to check. The money is never lost either way.
 */
export async function cancelSeat(bookingId, { reason, by }) {
  const result = await tx(async () => {
    const b = await getRow(bookingId);
    if (!b) throw notFound('Booking');
    if (!OPEN.includes(b.status)) throw new HttpError(409, 'CANNOT_CANCEL', 'Only a booking that is waiting or on a car (not boarded) can be cancelled.');
    const toMpesa = b.pay_with === 'mpesa' && !b.free_ride;
    await db.run(
      `UPDATE seat_bookings SET status = 'cancelled', cancelled_at = ${NOW}, cancel_reason = ?, refund_to = ? WHERE id = ?`,
      reason,
      b.free_ride ? null : toMpesa ? 'mpesa' : 'wallet',
      b.id,
    );
    await postWalletEntry(b.passenger_id, { type: 'booking_release', amount: b.amount, reference: b.code, description: `Seat booking ${b.code} cancelled` });
    // A free ride is not turned into money: the passenger keeps it for their next ride instead.
    if (b.free_ride) await reverseFreeRide(b.passenger_id, b.amount, b.code);
    let withdrawal = null;
    if (toMpesa) {
      const user = await db.get('SELECT id, phone FROM users WHERE id = ?', b.passenger_id);
      withdrawal = await createWithdrawal(user, b.amount, `Refund of seat booking ${b.code} to M-Pesa`);
      await db.run('UPDATE seat_bookings SET refund_withdrawal_id = ? WHERE id = ?', withdrawal.id, b.id);
    }
    await tell(b, {
      kind: 'seat.cancelled',
      title: `Booking ${b.code} cancelled`,
      body: b.free_ride
        ? `${reason}. Your free ride is kept for your next trip.`
        : `${reason}. ${kesText(b.amount)} ${toMpesa ? 'is being sent back to your M-Pesa' : 'is back in your FarePay wallet'}.`,
      sms: b.free_ride
        ? `Makos: booking ${b.code} cancelled (${reason}). Your free ride is kept for your next trip.`
        : `Makos: booking ${b.code} cancelled (${reason}). ${kesText(b.amount)} ${toMpesa ? 'is being sent back to your M-Pesa' : 'is back in your FarePay wallet'}.`,
    });
    if (b.status === 'assigned') {
      await tellCrew(b.vehicle_id, {
        kind: 'seat.cancelled',
        title: `Booking ${b.code} cancelled`,
        body: `Don't pick ${b.passenger_name} at ${pickupPlace(b)}.`,
        sms: b.pickup_stop_id ? `Makos: booking ${b.code} cancelled. Don't pick ${b.passenger_name} at ${b.pickup_name}.` : undefined,
      });
    }
    return { withdrawal, routeId: b.route_id, freedSeat: b.status === 'assigned', by };
  });
  if (result.withdrawal) await dispatchWithdrawal(result.withdrawal);
  if (result.freedSeat) await fillRoute(result.routeId);
  return seatView(bookingId);
}

/** At the cutoff: every booking not on a car (or on a car that never left) is refunded; tomorrow's bookings wait. */
export async function refundUnboarded() {
  const rows = await db.all(
    `SELECT sb.id FROM seat_bookings sb LEFT JOIN loads l ON l.id = sb.load_id
     WHERE (sb.status = 'queued' AND ${due('sb.queued_at')}) OR (sb.status = 'assigned' AND NOT (l.status = 'departed' AND l.finished_at IS NULL))`,
  );
  for (const { id } of rows) {
    try {
      await cancelSeat(id, { reason: 'No car took this booking today', by: 'system' });
    } catch (err) {
      console.error(`[seat refunds] booking ${id}:`, err.message);
    }
  }
  return rows.length;
}

export function startNightlySeatRefunds() {
  runDaily('seat_refunds', config.seatBookingCutoff, async () => {
    const n = await refundUnboarded();
    if (n) console.log(`[seat refunds] ${n} unboarded booking(s) refunded`);
  });
}

// ---------- The website (no sign-in: the booking link is a signed token) ----------

const SEAT_AUDIENCE = 'farepay-seat';
export const seatToken = (bookingId) => jwt.sign({ sid: bookingId }, config.jwtSecret, { audience: SEAT_AUDIENCE, expiresIn: '7d' });

/** The booking a website link is for. */
export function seatIdFromToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { audience: SEAT_AUDIENCE }).sid;
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Booking not found. Open the link from your booking again.');
  }
}

// ---------- Lists ----------

/** This passenger's seat bookings from the last 7 days, newest first (unpaid failed ones left out). */
export async function mySeats(passengerId) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = await db.all("SELECT id FROM seat_bookings WHERE passenger_id = ? AND created_at >= ? AND status != 'failed' ORDER BY id DESC LIMIT 20", passengerId, since);
  const out = [];
  for (const { id } of rows) out.push(await seatView(id));
  return out;
}

export async function mySeat(passengerId, bookingId) {
  const b = await db.get('SELECT id FROM seat_bookings WHERE id = ? AND passenger_id = ?', bookingId, passengerId);
  if (!b) throw notFound('Booking');
  return seatView(b.id);
}

const marshalBooking = (b, place) => ({
  id: b.id,
  code: b.code,
  status: b.status,
  seats: b.seats,
  amount: b.amount,
  stop_name: b.stop_name,
  pickup_name: b.pickup_stop_id ? b.pickup_name : null,
  passenger_name: b.passenger_name,
  passenger_phone: b.passenger_phone,
  passenger_here: Boolean(b.passenger_here_at),
  booked_at: b.queued_at ?? b.created_at,
  ready_at: b.ready_at,
  place,
});

/**
 * What the marshal sees for each route in use: the stage queue in order, road pickups waiting for a car, and the
 * cars loading or on the road with their seats and whom they carry (with the crew's numbers to call).
 */
export async function marshalQueues() {
  const routes = await listRoutes({ activeOnly: true });
  const out = [];
  for (const r of routes) {
    const waiting = await db.all(`${SEAT_SELECT} WHERE sb.route_id = ? AND sb.status = 'queued' AND ${due('sb.queued_at')} ORDER BY sb.queued_at, sb.id`, r.id);
    const later = await db.all(`${SEAT_SELECT} WHERE sb.route_id = ? AND sb.status = 'queued' AND sb.queued_at > ${NOW} ORDER BY sb.queued_at, sb.id`, r.id);
    const loads = await db.all(
      `SELECT l.*, v.plate, v.description, dr.name AS driver_name, dr.phone AS driver_phone, co.name AS conductor_name, co.phone AS conductor_phone
       FROM loads l JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users dr ON dr.id = v.driver_id LEFT JOIN users co ON co.id = v.conductor_id
       WHERE l.route_id = ? AND (l.status = 'loading' OR (l.status = 'departed' AND l.finished_at IS NULL)) ORDER BY l.started_at, l.id`,
      r.id,
    );
    const cars = [];
    for (const l of loads) {
      const onIt = await db.all(`${SEAT_SELECT} WHERE sb.load_id = ? AND sb.status IN ('assigned', 'boarded') ORDER BY sb.assigned_at, sb.id`, l.id);
      const reached = await db.all('SELECT stop_id FROM load_stops WHERE load_id = ?', l.id);
      cars.push({
        load_id: l.id,
        vehicle_id: l.vehicle_id,
        plate: l.plate,
        description: l.description,
        state: l.status === 'loading' ? 'loading' : 'on_the_road',
        seats: l.seats,
        seats_left: Math.max(0, l.seats - (await seatsTaken(l.id))),
        full: Boolean(l.full_at),
        started_at: l.started_at,
        departed_at: l.departed_at,
        stops_reached: reached.map((x) => x.stop_id),
        driver: l.driver_name ? { name: l.driver_name, phone: l.driver_phone } : null,
        conductor: l.conductor_name ? { name: l.conductor_name, phone: l.conductor_phone } : null,
        location: await carLocation(l.vehicle_id),
        bookings: onIt.map((b) => marshalBooking(b, null)),
      });
    }
    const stage = waiting.filter((b) => !b.pickup_stop_id);
    out.push({
      id: r.id,
      name: r.name,
      origin: r.origin,
      stops: r.stops.map((s) => ({ id: s.id, name: s.name })),
      stage_queue: stage.map((b, i) => marshalBooking(b, i + 1)),
      seats_waiting: stage.reduce((n, b) => n + b.seats, 0),
      road_pickups: waiting.filter((b) => b.pickup_stop_id).map((b) => marshalBooking(b, null)),
      // Booked for later (today or tomorrow): they join the queue at their "ready from" time.
      later: later.map((b) => marshalBooking(b, null)),
      cars,
    });
  }
  return { today: nairobiToday(), open: !bookingClosed(), routes: out };
}

/** Vehicles the marshal can say have arrived (search by plate), with what each is doing now. */
export async function marshalVehicles(q = '') {
  const plate = q.toUpperCase().replace(/\s+/g, '');
  return db.all(
    `SELECT v.id, v.plate, v.description, v.seats, v.route_id, r.name AS route_name,
            (SELECT l.status FROM loads l WHERE l.vehicle_id = v.id AND (l.status = 'loading' OR (l.status = 'departed' AND l.finished_at IS NULL)) LIMIT 1) AS busy
     FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id
     WHERE v.is_active = TRUE AND REPLACE(UPPER(v.plate), ' ', '') LIKE ? ORDER BY v.plate LIMIT 30`,
    `%${plate}%`,
  );
}

/** Seat bookings on this vehicle's car at the stage and on the road, for its crew (who to pick where). */
export async function crewSeats(vehicleId) {
  const rows = await db.all(
    `${SEAT_SELECT} WHERE l.vehicle_id = ? AND sb.status IN ('assigned', 'boarded')
     AND (l.status = 'loading' OR (l.status = 'departed' AND l.finished_at IS NULL)) ORDER BY ps.position, sb.assigned_at, sb.id`,
    vehicleId,
  );
  return rows.map((b) => ({ ...marshalBooking(b, null), pickup_name: pickupPlace(b), at_stage: !b.pickup_stop_id }));
}
