import { db, NOW, tx } from '../database.js';
import { HttpError } from '../errors.js';
import { parseQr, randomCode } from '../util.js';
import { kesText, notify } from './notifications.js';
import { applyDueFareChanges, getRoute, getStop, requireActiveStop } from './routes.js';
import { getBalance, postWalletEntry } from './wallet.js';

const RECENT_PAYMENT_WINDOW_MS = 30 * 60 * 1000;

/** The vehicle behind a scanned QR code, and the route it is on. */
async function loadVehicle(qr) {
  await applyDueFareChanges(); // a fare change dated today must apply before anyone is quoted or charged
  const vehicle = await db.get(
    `SELECT v.*, c.name AS conductor_name FROM vehicles v LEFT JOIN users c ON c.id = v.conductor_id AND c.is_active = TRUE
     WHERE v.qr_token = ?`,
    parseQr(qr),
  );
  if (!vehicle || !vehicle.is_active) throw new HttpError(404, 'INVALID_QR', 'This is not a valid FarePay vehicle code');
  const route = vehicle.route_id ? await getRoute(vehicle.route_id) : null;
  if (!route || !route.is_active || route.stops.length === 0) {
    throw new HttpError(409, 'NO_ROUTE', 'This vehicle has no route set yet. Please ask the conductor.');
  }
  return { vehicle, route };
}

/**
 * What the passenger sees after scanning, before paying. `chosenStopId` is the drop-off they picked on the
 * home screen. If it is on this vehicle's route its fare is quoted; otherwise the passenger picks a stop
 * from `route.stops` and the app asks again.
 */
export async function quoteFare(passengerId, qr, chosenStopId) {
  const { vehicle, route } = await loadVehicle(qr);
  const balance = await getBalance(passengerId);
  const since = new Date(Date.now() - RECENT_PAYMENT_WINDOW_MS).toISOString();
  const recent = await db.get(
    "SELECT ticket_code, created_at FROM trips WHERE passenger_id = ? AND vehicle_id = ? AND status = 'paid' AND created_at >= ? ORDER BY id DESC LIMIT 1",
    passengerId,
    vehicle.id,
    since,
  );

  const chosen = chosenStopId ? await getStop(chosenStopId) : null;
  const onThisRoute = chosen && chosen.route_id === route.id && chosen.is_active;
  // A route with a single stop needs no choosing.
  const stop = onThisRoute ? chosen : route.stops.length === 1 ? route.stops[0] : null;
  const otherRoute = chosen && !onThisRoute ? await db.get('SELECT name FROM routes WHERE id = ?', chosen.route_id) : null;

  return {
    vehicle: { id: vehicle.id, plate: vehicle.plate, description: vehicle.description, conductor_name: vehicle.conductor_name ?? null },
    route: { id: route.id, name: route.name, origin: route.origin, stops: route.stops },
    stop: stop ? { id: stop.id, name: stop.name } : null,
    fare: stop?.app_fare ?? null,
    cash_fare: stop?.cash_fare ?? null,
    you_save: stop ? stop.cash_fare - stop.app_fare : null,
    wallet_balance: balance,
    can_pay: stop ? balance >= stop.app_fare : false,
    shortfall: stop ? Math.max(0, stop.app_fare - balance) : 0,
    // Set when the drop-off the passenger chose is on a different route from this vehicle's.
    chosen_elsewhere: otherRoute ? { route_name: otherRoute.name, stop_name: chosen.name } : null,
    // "You already paid on this vehicle 5 minutes ago": avoids paying twice by mistake.
    recent_payment: recent ?? null,
  };
}

async function uniqueTicketCode() {
  for (;;) {
    const code = randomCode(6);
    if (!(await db.get('SELECT 1 FROM trips WHERE ticket_code = ?', code))) return code;
  }
}

export const TRIP_SELECT = `
  SELECT t.id, t.ticket_code, t.fare, t.cash_fare, t.cash_fare - t.fare AS saved, t.created_at,
         t.passenger_id, p.name AS passenger_name, p.phone AS passenger_phone,
         t.vehicle_id, v.plate, v.description AS vehicle_description,
         t.route_id, r.name AS route_name, r.origin, t.stop_id, t.stop_name,
         t.conductor_id, c.name AS conductor_name, t.owner_name, t.owner_phone, t.payout_id,
         t.status, t.refunded_at, t.refund_reason
  FROM trips t
  JOIN users p ON p.id = t.passenger_id
  JOIN vehicles v ON v.id = t.vehicle_id
  JOIN routes r ON r.id = t.route_id
  LEFT JOIN users c ON c.id = t.conductor_id`;

export const getTrip = (id) => db.get(`${TRIP_SELECT} WHERE t.id = ?`, id);

/**
 * Pays the fare from the wallet. `expectedFare` is the fare the passenger saw; if it changed since,
 * we refuse rather than charge a surprise amount. `idempotencyKey` (one per confirmation, made by the
 * app) means a retry after a network failure never charges twice.
 */
export function payFare({ passengerId, qr, stopId, expectedFare, idempotencyKey }) {
  return tx(async () => {
    const existing = await findTrip(passengerId, idempotencyKey);
    if (existing) return { trip: existing, replayed: true };
    const { vehicle, stop } = await checkFare(qr, stopId, expectedFare);
    const tripId = await recordTrip({ passengerId, vehicle, stop, fare: stop.app_fare, idempotencyKey });
    return { trip: await getTrip(tripId), replayed: false };
  });
}

/**
 * The SACCO office refunds a fare (vehicle broke down, wrong charge...): the money goes back to the
 * passenger's wallet. If the owner hasn't been paid it yet, it's simply left out of their payout;
 * if they have, it's taken off their next payout.
 */
export function refundTrip(tripId, reason) {
  return tx(async () => {
    const trip = await db.get('SELECT * FROM trips WHERE id = ?', tripId);
    if (!trip) throw new HttpError(404, 'NOT_FOUND', 'Payment not found');
    if (trip.status === 'refunded') throw new HttpError(409, 'ALREADY_REFUNDED', 'This payment has already been refunded');

    await db.run(`UPDATE trips SET status = 'refunded', refund_reason = ?, refunded_at = ${NOW} WHERE id = ?`, reason, tripId);
    await postWalletEntry(trip.passenger_id, { type: 'refund', amount: trip.fare, reference: trip.ticket_code, description: `Refund: ${reason}` });
    if (trip.payout_id) {
      await db.run('INSERT INTO owner_deductions (owner_phone, amount, trip_id) VALUES (?, ?, ?)', trip.owner_phone, trip.fare, trip.id);
    }
    await notify([trip.passenger_id], {
      kind: 'fare.refunded',
      title: `${kesText(trip.fare)} refunded to your wallet`,
      body: `Ticket ${trip.ticket_code}${trip.stop_name ? ` to ${trip.stop_name}` : ''}. Reason: ${reason}`,
      target: 'trips',
    });
    return getTrip(tripId);
  });
}

/** The trip already paid for with this confirmation, if any. */
export async function findTrip(passengerId, idempotencyKey) {
  const existing = await db.get('SELECT id FROM trips WHERE passenger_id = ? AND idempotency_key = ?', passengerId, idempotencyKey);
  return existing ? getTrip(existing.id) : null;
}

/** The vehicle and stop being paid for, refusing if the fare is not the one the passenger saw. */
export async function checkFare(qr, stopId, expectedFare) {
  const { vehicle, route } = await loadVehicle(qr);
  const stop = await requireActiveStop(route.id, stopId);
  if (stop.app_fare !== expectedFare) {
    throw new HttpError(409, 'FARE_CHANGED', 'The fare has changed. Please check the new fare and confirm again.', { fare: stop.app_fare });
  }
  return { vehicle, route, stop };
}

/**
 * Takes the fare from the wallet and records the trip with a new ticket code. Must run inside tx().
 * Also used when a fare paid by M-Pesa is confirmed: that money is first added to the wallet, then taken here.
 */
export async function recordTrip({ passengerId, vehicle, stop, fare, idempotencyKey }) {
  const route = await db.get('SELECT id, name FROM routes WHERE id = ?', stop.route_id);
  const ticketCode = await uniqueTicketCode();
  await postWalletEntry(passengerId, {
    type: 'fare',
    amount: -fare,
    reference: ticketCode,
    description: `${vehicle.plate} · ${route.name} to ${stop.name}`,
  });
  return db.insert(
    `INSERT INTO trips (ticket_code, passenger_id, vehicle_id, route_id, stop_id, stop_name, conductor_id, owner_name, owner_phone,
                        fare, cash_fare, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ticketCode,
    passengerId,
    vehicle.id,
    route.id,
    stop.id,
    stop.name,
    vehicle.conductor_id,
    vehicle.owner_name,
    vehicle.owner_phone,
    fare,
    stop.cash_fare,
    idempotencyKey,
  );
}
