// Paying without the app: the phone's own camera opens the QR sticker's link (the pay page, /pay?v=...), the
// passenger picks their stop and types their M-Pesa number, and gets the PIN prompt. The fare is recorded
// exactly like an app passenger's M-Pesa fare (same ticket, conductor's list, owner payout and money check),
// under a passenger account for that phone number that has no password until they sign up in the app.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db, tx } from '../database.js';
import { HttpError } from '../errors.js';
import { getPayment, refreshPayment, startFarePayment } from './payments.js';
import { getTrip, loadVehicle } from './trips.js';
import { NO_APP_PASSWORD } from './users.js';

// The pay page follows its payment with this token (only the payment's id inside, signed, for two days).
const STATUS_AUDIENCE = 'farepay-no-app-payment';

/** What the pay page shows after the sticker is scanned: the vehicle, its route and the fare to each stop. */
export async function vehicleForPayPage(qr) {
  const { vehicle, route } = await loadVehicle(qr);
  return {
    sacco_name: config.saccoName,
    vehicle: { plate: vehicle.plate, description: vehicle.description },
    route: {
      id: route.id,
      name: route.name,
      origin: route.origin,
      stops: route.stops.map((s) => ({ id: s.id, name: s.name, fare: s.app_fare })),
    },
  };
}

/** The passenger account for this M-Pesa number: theirs if they have the app, otherwise one without a password. */
export async function passengerFor(phone) {
  return tx(async () => {
    const user = await db.get('SELECT id, role, is_active FROM users WHERE phone = ?', phone);
    if (user) {
      if (user.role !== 'passenger') throw new HttpError(409, 'NOT_A_PASSENGER_NUMBER', 'This number belongs to a FarePay staff account. Please pay with another M-Pesa number.');
      if (!user.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This number cannot pay with FarePay. Please contact the SACCO office.');
      return user.id;
    }
    const id = await db.insert("INSERT INTO users (name, phone, password_hash, role) VALUES ('M-Pesa passenger (no app)', ?, ?, 'passenger')", phone, NO_APP_PASSWORD);
    await db.run('INSERT INTO wallets (user_id) VALUES (?)', id);
    return id;
  });
}

/** Sends the PIN prompt for one fare. Returns the token the page uses to follow it. */
export async function startNoAppFare({ qr, stopId, expectedFare, phone, idempotencyKey }) {
  const userId = await passengerFor(phone);
  const started = await startFarePayment(userId, { qr, stopId, expectedFare, idempotencyKey, phone });
  // A free ride (loyalty): paid at once by the SACCO, no M-Pesa prompt and nothing to follow.
  if (started.trip?.free_ride) return { status: 'paid', amount: 0, reason: null, free_ride: true, ticket: ticketOf(started.trip) };
  const payment = await db.get('SELECT id FROM mpesa_payments WHERE user_id = ? AND idempotency_key = ? ORDER BY id DESC LIMIT 1', userId, idempotencyKey);
  return {
    status_token: jwt.sign({ pid: payment.id }, config.jwtSecret, { audience: STATUS_AUDIENCE, expiresIn: '2d' }),
    ...(await noAppPaymentStatus(payment.id)),
  };
}

async function noAppPaymentStatus(paymentId) {
  const payment = await refreshPayment(await getPayment(paymentId));
  const trip = payment.trip_id ? await getTrip(payment.trip_id) : null;
  return {
    // waiting | paid | failed (paid without a ticket only when M-Pesa confirmed too late: the money is in their wallet)
    status: trip ? 'paid' : payment.status === 'completed' ? 'paid_late' : payment.status === 'failed' ? 'failed' : 'waiting',
    amount: payment.amount,
    reason: payment.status === 'failed' ? payment.result_desc : null,
    ticket: trip && ticketOf(trip),
  };
}

const ticketOf = (trip) => ({
  code: trip.ticket_code,
  plate: trip.plate,
  route_name: trip.route_name,
  stop_name: trip.stop_name,
  fare: trip.fare,
  paid_at: trip.created_at,
  status: trip.status,
  free_ride: Boolean(trip.free_ride),
});

/** The pay page asks how its payment is going (and M-Pesa is asked if it is still waiting). */
export async function noAppPaymentByToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { audience: STATUS_AUDIENCE });
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Payment not found. Scan the sticker again.');
  }
  return noAppPaymentStatus(payload.pid);
}
