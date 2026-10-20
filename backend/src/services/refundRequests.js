// "Paid by mistake": a conductor or driver asks the office to refund a fare paid on their car (wrong car, paid twice,
// passenger didn't travel...). Crew can never move money themselves: the office looks at the request and refunds it
// (the usual fare refund) or says no, with a note the crew see. Passengers with the app get the money in their
// FarePay wallet; passengers who paid without the app (pay page, USSD) have no wallet to use, so it goes on to their
// M-Pesa.
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiDayRange, nairobiToday } from '../util.js';
import { kesText, notify, notifyOffice } from './notifications.js';
import { refundTrip } from './trips.js';
import { NO_APP_PASSWORD } from './users.js';
import { createWithdrawal, dispatchWithdrawal } from './withdrawals.js';

// Crew see their car's payments for today and the 3 days before; they can ask about any of those.
const OLDEST_DAYS = 3;

const SELECT = `
  SELECT rr.id, rr.trip_id, rr.reason, rr.status, rr.office_note, rr.created_at, rr.decided_at,
         rr.requested_by, c.name AS requested_by_name, c.role AS requested_by_role, d.name AS decided_by_name,
         t.ticket_code, t.fare, t.free_ride, t.stop_name, t.created_at AS paid_at, t.status AS trip_status,
         t.passenger_id, p.name AS passenger_name, p.phone AS passenger_phone, p.password_hash = '${NO_APP_PASSWORD}' AS no_app,
         t.vehicle_id, v.plate, r.name AS route_name
  FROM refund_requests rr
  JOIN trips t ON t.id = rr.trip_id
  JOIN users p ON p.id = t.passenger_id
  JOIN users c ON c.id = rr.requested_by
  LEFT JOIN users d ON d.id = rr.decided_by
  JOIN vehicles v ON v.id = t.vehicle_id
  JOIN routes r ON r.id = t.route_id`;

const view = ({ requested_by, passenger_id, ...row }) => ({ ...row, no_app: !!row.no_app, free_ride: !!row.free_ride });
const getRequest = async (id) => {
  const row = await db.get(`${SELECT} WHERE rr.id = ?`, id);
  return row && view(row);
};

/** The crew member asks for a refund of a payment made on their car. */
export async function askRefund({ user, vehicleId, tripId, reason }) {
  const id = await tx(async () => {
    const trip = await db.get('SELECT id, vehicle_id, status, fare, ticket_code, created_at FROM trips WHERE id = ?', tripId);
    if (!trip || trip.vehicle_id !== vehicleId) throw notFound('Payment');
    if (trip.status === 'refunded') throw new HttpError(409, 'ALREADY_REFUNDED', 'This payment has already been refunded.');
    const [oldest] = nairobiDayRange(new Date(Date.parse(`${nairobiToday()}T00:00:00Z`) - OLDEST_DAYS * 86_400_000).toISOString().slice(0, 10));
    if (new Date(trip.created_at) < new Date(oldest)) {
      throw new HttpError(400, 'TOO_OLD', 'This payment is too old to ask about here. Ask the SACCO office.');
    }
    if (await db.get("SELECT 1 FROM refund_requests WHERE trip_id = ? AND status = 'waiting'", tripId)) {
      throw new HttpError(409, 'ALREADY_ASKED', 'A refund for this payment has already been asked. The office will decide.');
    }
    return db.insert('INSERT INTO refund_requests (trip_id, requested_by, reason) VALUES (?, ?, ?)', tripId, user.id, reason);
  });
  const request = await getRequest(id);
  await notifyOffice({
    kind: 'refund_request.new',
    title: `Refund asked: ${kesText(request.fare)} on ${request.plate}`,
    body: `${request.requested_by_name} (${request.requested_by_role}): ${reason}. Ticket ${request.ticket_code}.`,
    target: 'refund-requests',
  });
  return request;
}

/** Requests for the office: waiting ones first (oldest first), or every request (newest first). */
export async function listRefundRequests({ status }) {
  const rows =
    status === 'waiting'
      ? await db.all(`${SELECT} WHERE rr.status = 'waiting' ORDER BY rr.id`)
      : await db.all(`${SELECT} ORDER BY rr.id DESC LIMIT 200`);
  return rows.map(view);
}

/** The latest request for each of these payments (for the crew's payment list). */
export async function requestsForTrips(tripIds) {
  if (tripIds.length === 0) return new Map();
  const rows = await db.all(
    `SELECT trip_id, status, office_note FROM refund_requests WHERE trip_id IN (${tripIds.map(() => '?').join(', ')}) ORDER BY id`,
    ...tripIds,
  );
  return new Map(rows.map((r) => [r.trip_id, { status: r.status, office_note: r.office_note }]));
}

async function decide(id, officeUserId, apply) {
  const result = await tx(async () => {
    const request = await db.get('SELECT * FROM refund_requests WHERE id = ?', id);
    if (!request) throw notFound('Refund request');
    if (request.status !== 'waiting') throw new HttpError(409, 'ALREADY_DECIDED', 'This request has already been decided.');
    return { ...(await apply(request)), crewId: request.requested_by };
  });
  if (result.withdrawal) await dispatchWithdrawal(result.withdrawal);
  const request = await getRequest(id);
  await notify([result.crewId], result.tellCrew(request));
  return request;
}

/** The office refunds the fare: to the wallet, then on to M-Pesa for a passenger without the app. */
export function approveRefund(id, officeUserId) {
  return decide(id, officeUserId, async (request) => {
    const trip = await db.get('SELECT id, status, passenger_id, fare, free_ride FROM trips WHERE id = ?', request.trip_id);
    // Refunded meanwhile from the payments screen: the request is simply done.
    if (trip.status !== 'refunded') await refundTrip(trip.id, `Paid by mistake: ${request.reason}`);
    await db.run(`UPDATE refund_requests SET status = 'refunded', decided_by = ?, decided_at = ${NOW} WHERE id = ?`, officeUserId, id);
    let withdrawal = null;
    const passenger = await db.get('SELECT id, phone, password_hash FROM users WHERE id = ?', trip.passenger_id);
    if (trip.status !== 'refunded' && !trip.free_ride && passenger.password_hash === NO_APP_PASSWORD) {
      withdrawal = await createWithdrawal(passenger, trip.fare, 'Refund of a fare paid by mistake, to M-Pesa');
    }
    return {
      withdrawal,
      tellCrew: (r) => ({
        kind: 'refund_request.refunded',
        title: `Refund done: ${kesText(r.fare)}, ticket ${r.ticket_code}`,
        body: `The office refunded the passenger${r.no_app ? ' to their M-Pesa' : ''}.`,
        target: 'payments',
      }),
    };
  });
}

/** The office says no, with a short note for the crew. */
export function declineRefund(id, officeUserId, note) {
  return decide(id, officeUserId, async () => {
    await db.run(`UPDATE refund_requests SET status = 'declined', office_note = ?, decided_by = ?, decided_at = ${NOW} WHERE id = ?`, note, officeUserId, id);
    return {
      withdrawal: null,
      tellCrew: (r) => ({
        kind: 'refund_request.declined',
        title: `Refund not given: ticket ${r.ticket_code}`,
        body: `The office said: ${note}`,
        target: 'payments',
      }),
    };
  });
}
