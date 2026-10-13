// Parcels: the office records a parcel at the counter and the sender pays the fee: by the M-Pesa PIN prompt, or the
// clerk records cash or an M-Pesa code. Fees are the SACCO's income, kept apart from fares, owner payouts and
// passenger wallets. A car on the route carries it; the receiver collects it with a secret collection code.
import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { limiter } from '../ratelimit.js';
import { maskPhone, randomCode, safeEqual } from '../util.js';
import { typicalMinutes } from './bookings.js';
import * as mpesa from './mpesa.js';
import { getRoute, requireActiveStop } from './routes.js';

// What a PIN prompt that never got an answer is marked with (a late "success" can still complete it).
const EXPIRED = 'No answer from M-Pesa (expired)';
const STILL_PROCESSING = new Set(['4999']);

// Guessing a collection code: 5 wrong tries per parcel, then a 15-minute wait.
const wrongCodeByParcel = limiter({ windowMs: 15 * 60_000, max: 5, message: (m) => `Too many wrong codes for this parcel. Try again in ${m} minute${m === 1 ? '' : 's'}.` });

async function uniqueTrackingCode() {
  for (;;) {
    const code = randomCode(8);
    if (!(await db.get('SELECT 1 FROM parcels WHERE tracking_code = ?', code))) return code;
  }
}
const newCollectionCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const PARCEL_SELECT = `
  SELECT p.*, r.name AS route_name, r.origin, s.name AS stop_name, v.plate,
         u.name AS created_by_name, c.name AS collected_by_name
  FROM parcels p
  JOIN routes r ON r.id = p.route_id
  JOIN route_stops s ON s.id = p.stop_id
  LEFT JOIN vehicles v ON v.id = p.vehicle_id
  JOIN users u ON u.id = p.created_by
  LEFT JOIN users c ON c.id = p.collected_by`;

// ---------- Office ----------

/** One parcel with its PIN prompts, as the office sees it (including the collection code, to tell the sender). */
export async function getParcel(parcelId) {
  const p = await db.get(`${PARCEL_SELECT} WHERE p.id = ?`, parcelId);
  if (!p) throw notFound('Parcel');
  const payments = await db.all(
    'SELECT id, phone, amount, status, mpesa_receipt, result_desc, created_at, completed_at FROM parcel_payments WHERE parcel_id = ? ORDER BY id DESC',
    parcelId,
  );
  return { ...p, payments };
}

/** The office's list: newest first, optionally one status, or a tracking code / phone number / name search. */
export async function listParcels({ status, search, limit = 100 }) {
  const where = [];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    where.push('(LOWER(p.tracking_code) LIKE ? OR p.sender_phone LIKE ? OR p.receiver_phone LIKE ? OR LOWER(p.sender_name) LIKE ? OR LOWER(p.receiver_name) LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const rows = await db.all(`${PARCEL_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.id DESC LIMIT ?`, ...params, limit);
  const totals = await db.get(
    "SELECT COUNT(*) AS paid, COALESCE(SUM(fee), 0) AS fees FROM parcels WHERE paid_at IS NOT NULL AND status <> 'cancelled' AND paid_at >= ?",
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
  );
  return { parcels: rows, last_30_days: totals };
}

/**
 * Records a parcel and takes the fee: `payment` is 'prompt' (M-Pesa PIN prompt to the sender), 'cash', or
 * 'mpesa_code' (paid some other M-Pesa way; the clerk types the code).
 */
export async function createParcel(body, userId) {
  const route = await getRoute(body.route_id);
  if (!route || !route.is_active) throw notFound('Route');
  await requireActiveStop(route.id, body.stop_id);
  const parcelId = await db.insert(
    `INSERT INTO parcels (tracking_code, collection_code, sender_name, sender_phone, receiver_name, receiver_phone, route_id, stop_id,
                          description, fee, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    await uniqueTrackingCode(),
    newCollectionCode(),
    body.sender_name,
    body.sender_phone,
    body.receiver_name,
    body.receiver_phone,
    route.id,
    body.stop_id,
    body.description ?? null,
    body.fee,
    userId,
  );
  if (body.payment === 'prompt') await sendParcelPrompt(parcelId).catch(() => {}); // a failed prompt can be sent again
  else await recordPayment(parcelId, { method: body.payment, reference: body.mpesa_code });
  return getParcel(parcelId);
}

/** The fee was paid in cash, or by M-Pesa some other way (the clerk types the M-Pesa code). */
export async function recordPayment(parcelId, { method, reference }) {
  await tx(async () => {
    if (method === 'mpesa_code') {
      const code = reference.toUpperCase();
      const used =
        (await db.get("SELECT 1 FROM parcels WHERE UPPER(payment_reference) = ? AND payment_method IN ('mpesa_code', 'mpesa_prompt')", code)) ||
        (await db.get('SELECT 1 FROM parcel_payments WHERE UPPER(mpesa_receipt) = ?', code)) ||
        (await db.get('SELECT 1 FROM mpesa_payments WHERE UPPER(mpesa_receipt) = ?', code));
      if (used) throw new HttpError(409, 'CODE_USED', 'This M-Pesa code has already been recorded for another payment.');
      reference = code;
    }
    const done = await db.run(
      `UPDATE parcels SET status = 'received', payment_method = ?, payment_reference = ?, paid_at = ${NOW} WHERE id = ? AND status = 'awaiting_payment'`,
      method,
      method === 'cash' ? null : reference,
      parcelId,
    );
    if (!done.changes) {
      if (!(await db.get('SELECT 1 FROM parcels WHERE id = ?', parcelId))) throw notFound('Parcel');
      throw new HttpError(409, 'NOT_AWAITING_PAYMENT', 'This parcel is already paid (or cancelled).');
    }
  });
  return getParcel(parcelId);
}

/** Sends the M-Pesa PIN prompt for the fee to the sender's phone. */
export async function sendParcelPrompt(parcelId) {
  if (!mpesa.isConfigured.stk) throw new HttpError(503, 'MPESA_NOT_CONFIGURED', 'M-Pesa payments are not set up yet.');
  const p = await db.get('SELECT * FROM parcels WHERE id = ?', parcelId);
  if (!p) throw notFound('Parcel');
  if (p.status !== 'awaiting_payment') throw new HttpError(409, 'NOT_AWAITING_PAYMENT', 'This parcel is already paid (or cancelled).');
  const waiting = await db.get("SELECT created_at FROM parcel_payments WHERE parcel_id = ? AND status IN ('initiating', 'pending') ORDER BY id DESC LIMIT 1", parcelId);
  if (waiting && Date.now() - Date.parse(waiting.created_at) < 90_000) {
    throw new HttpError(409, 'PROMPT_WAITING', 'A PIN prompt was sent less than 90 seconds ago. Wait for the sender to answer it.');
  }
  const paymentId = await db.insert("INSERT INTO parcel_payments (parcel_id, phone, amount, status) VALUES (?, ?, ?, 'initiating')", parcelId, p.sender_phone, p.fee);
  let response;
  try {
    response = await mpesa.stkPush({ phone: p.sender_phone, amount: p.fee, accountReference: p.tracking_code, description: 'Parcel' });
  } catch (err) {
    await db.run("UPDATE parcel_payments SET status = 'failed', result_desc = ? WHERE id = ?", String(err.message), paymentId);
    throw new HttpError(502, 'MPESA_UNAVAILABLE', 'Could not reach M-Pesa. Try again, or record a cash payment.');
  }
  await db.run(
    "UPDATE parcel_payments SET status = 'pending', checkout_request_id = ?, merchant_request_id = ? WHERE id = ?",
    response.CheckoutRequestID,
    response.MerchantRequestID,
    paymentId,
  );
  // Tests only: pretend the sender entered their PIN.
  if (mpesa.isMock) await handleParcelStkCallback(mpesa.mockStkCallback({ checkoutRequestId: response.CheckoutRequestID, amount: p.fee, phone: p.sender_phone }).Body.stkCallback);
  return getParcel(parcelId);
}

/**
 * M-Pesa's answer to a parcel PIN prompt (its callback, or one built from asking Safaricom). Returns false if the
 * prompt was not a parcel's. Safe to receive more than once.
 */
export async function handleParcelStkCallback(cb) {
  return tx(async () => {
    const payment = await db.get('SELECT * FROM parcel_payments WHERE checkout_request_id = ?', cb.CheckoutRequestID);
    if (!payment) return false;
    const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
    const receipt = items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : null;
    const success = Number(cb.ResultCode) === 0;
    const markParcelPaid = () =>
      db.run(
        `UPDATE parcels SET status = 'received', payment_method = 'mpesa_prompt', payment_reference = ?, paid_at = ${NOW}
         WHERE id = ? AND status = 'awaiting_payment'`,
        receipt,
        payment.parcel_id,
      );

    // Already confirmed by asking Safaricom: just add the receipt number that only the callback carries.
    if (payment.status === 'completed' && success && receipt && !payment.mpesa_receipt) {
      await db.run('UPDATE parcel_payments SET mpesa_receipt = ? WHERE id = ?', receipt, payment.id);
      await db.run("UPDATE parcels SET payment_reference = ? WHERE id = ? AND payment_method = 'mpesa_prompt' AND payment_reference IS NULL", receipt, payment.parcel_id);
      return true;
    }
    // Paid after FarePay gave up waiting: the money came in, so the parcel is paid (if it isn't already).
    const late = payment.status === 'failed' && payment.result_desc === EXPIRED && success;
    if (payment.status !== 'pending' && !late) return true;
    if (!success) {
      await db.run(`UPDATE parcel_payments SET status = 'failed', result_desc = ?, completed_at = ${NOW} WHERE id = ?`, String(cb.ResultDesc ?? 'Not paid'), payment.id);
      return true;
    }
    await db.run(
      `UPDATE parcel_payments SET status = 'completed', mpesa_receipt = ?, result_desc = ?, completed_at = ${NOW} WHERE id = ?`,
      receipt,
      late ? 'Confirmed late by M-Pesa' : String(cb.ResultDesc ?? 'Success'),
      payment.id,
    );
    await markParcelPaid();
    return true;
  });
}

/** If a parcel prompt is still waiting, asks M-Pesa for the answer (at most every few seconds). */
async function refreshParcelPayment(payment) {
  if (mpesa.isMock || payment.status !== 'pending' || !payment.checkout_request_id) return;
  const wait = config.mpesa.queryIntervalMs;
  if (wait > 0 && payment.last_queried_at && Date.now() - Date.parse(payment.last_queried_at) < wait) return;
  await db.run(`UPDATE parcel_payments SET last_queried_at = ${NOW} WHERE id = ?`, payment.id);
  let result;
  try {
    result = await mpesa.stkQuery(payment.checkout_request_id);
  } catch {
    return; // usually "still being processed"
  }
  if (result.ResultCode !== undefined && !STILL_PROCESSING.has(String(result.ResultCode))) {
    await handleParcelStkCallback({
      CheckoutRequestID: payment.checkout_request_id,
      ResultCode: result.ResultCode,
      ResultDesc: result.ResultDesc,
      ...(result.MpesaReceiptNumber && { CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: result.MpesaReceiptNumber }] } }),
    });
  }
}

/** The office opens a parcel: its waiting prompt is checked with M-Pesa first. */
export async function refreshedParcel(parcelId) {
  for (const payment of await db.all("SELECT * FROM parcel_payments WHERE parcel_id = ? AND status = 'pending'", parcelId)) {
    await refreshParcelPayment(payment);
  }
  return getParcel(parcelId);
}

/** Background safety net (with the passengers' payments): answers waiting parcel prompts; gives up after a while. */
export async function reconcileParcelPayments({ expireAfterMs = config.mpesa.pendingExpiryMs } = {}) {
  for (const payment of await db.all("SELECT * FROM parcel_payments WHERE status = 'pending'")) {
    await refreshParcelPayment(payment);
    const current = await db.get('SELECT * FROM parcel_payments WHERE id = ?', payment.id);
    if (current.status === 'pending' && Date.now() - Date.parse(current.created_at) > expireAfterMs) {
      await db.run(`UPDATE parcel_payments SET status = 'failed', result_desc = ?, completed_at = ${NOW} WHERE id = ? AND status = 'pending'`, EXPIRED, current.id);
    }
  }
}

/** A parcel that has not left yet is cancelled. A paid fee is refunded to the sender outside FarePay. */
export async function cancelParcel(parcelId, reason) {
  const done = await db.run(
    `UPDATE parcels SET status = 'cancelled', cancel_reason = ?, cancelled_at = ${NOW} WHERE id = ? AND status IN ('awaiting_payment', 'received')`,
    reason,
    parcelId,
  );
  if (!done.changes) {
    if (!(await db.get('SELECT 1 FROM parcels WHERE id = ?', parcelId))) throw notFound('Parcel');
    throw new HttpError(409, 'CANNOT_CANCEL', 'Only a parcel that has not been loaded onto a car can be cancelled.');
  }
  return getParcel(parcelId);
}

/** The receiver collects the parcel, showing their collection code. `vehicleId` = the crew's car (crew only). */
export async function collectParcel(parcelId, code, userId, { vehicleId = null } = {}) {
  const p = await db.get('SELECT * FROM parcels WHERE id = ?', parcelId);
  if (!p || (vehicleId !== null && p.vehicle_id !== vehicleId)) throw notFound('Parcel');
  const allowed = vehicleId !== null ? ['on_the_way', 'arrived'] : ['received', 'on_the_way', 'arrived'];
  if (!allowed.includes(p.status)) throw new HttpError(409, 'CANNOT_COLLECT', p.status === 'collected' ? 'This parcel has already been collected.' : 'This parcel can not be collected now.');
  wrongCodeByParcel.check(String(parcelId));
  if (!safeEqual(String(code).trim(), p.collection_code)) {
    wrongCodeByParcel.record(String(parcelId));
    throw new HttpError(400, 'WRONG_CODE', 'That collection code is not right. Ask the receiver for the 6-digit code from the sender.');
  }
  wrongCodeByParcel.reset(String(parcelId));
  await db.run(`UPDATE parcels SET status = 'collected', collected_by = ?, collected_at = ${NOW} WHERE id = ? AND status IN ('received', 'on_the_way', 'arrived')`, userId, parcelId);
  return getParcel(parcelId);
}

// ---------- Crew ----------

const forCrew = (p) => ({
  id: p.id,
  tracking_code: p.tracking_code,
  status: p.status,
  description: p.description,
  stop_name: p.stop_name,
  receiver_name: p.receiver_name,
  receiver_phone: maskPhone(p.receiver_phone),
  created_at: p.created_at,
  loaded_at: p.loaded_at,
  arrived_at: p.arrived_at,
});

/** Paid parcels waiting at the office for this car's route, and the parcels on this car. */
export async function crewParcels(vehicle) {
  const waiting = vehicle.route_id
    ? await db.all(`${PARCEL_SELECT} WHERE p.status = 'received' AND p.route_id = ? ORDER BY p.id`, vehicle.route_id)
    : [];
  const onCar = await db.all(`${PARCEL_SELECT} WHERE p.vehicle_id = ? AND p.status IN ('on_the_way', 'arrived') ORDER BY p.id`, vehicle.id);
  return { waiting: waiting.map(forCrew), on_car: onCar.map(forCrew) };
}

/** The crew put a paid parcel for their route on the car. */
export async function loadParcel(vehicle, parcelId) {
  const load = await db.get(
    "SELECT id FROM loads WHERE vehicle_id = ? AND (status = 'loading' OR (status = 'departed' AND finished_at IS NULL)) ORDER BY id DESC LIMIT 1",
    vehicle.id,
  );
  const done = await db.run(
    `UPDATE parcels SET status = 'on_the_way', vehicle_id = ?, load_id = ?, loaded_at = ${NOW} WHERE id = ? AND status = 'received' AND route_id = ?`,
    vehicle.id,
    load?.id ?? null,
    parcelId,
    vehicle.route_id,
  );
  if (!done.changes) throw new HttpError(409, 'CANNOT_LOAD', 'This parcel is not waiting for your route (it may be unpaid, already loaded, or for another route).');
  return crewParcels(vehicle);
}

/** The parcel is at its destination (also set when the crew tick that stop on the trip). */
export async function arriveParcel(vehicle, parcelId) {
  const done = await db.run(`UPDATE parcels SET status = 'arrived', arrived_at = ${NOW} WHERE id = ? AND vehicle_id = ? AND status = 'on_the_way'`, parcelId, vehicle.id);
  if (!done.changes) throw new HttpError(409, 'CANNOT_ARRIVE', 'This parcel is not on the way on your car.');
  return crewParcels(vehicle);
}

// ---------- Anyone with the tracking code (the website) ----------

const firstNameAndInitial = (name) => {
  const [first, ...rest] = String(name).trim().split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)[0].toUpperCase()}.` : first;
};

/** Where a parcel is. Shows no phone numbers, fee or collection code. */
export async function trackParcel(trackingCode) {
  const p = await db.get(`${PARCEL_SELECT} WHERE p.tracking_code = ?`, String(trackingCode).trim().toUpperCase());
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'No parcel has this tracking code. Check the code on your receipt.');
  let expected = null;
  if (p.status === 'on_the_way' && p.load_id) {
    const load = await db.get('SELECT departed_at, finished_at FROM loads WHERE id = ?', p.load_id);
    const minutes = load?.departed_at && !load.finished_at ? await typicalMinutes(p.stop_id) : null;
    if (minutes !== null) expected = new Date(Date.parse(load.departed_at) + minutes * 60_000).toISOString();
  }
  const left = p.load_id ? (await db.get('SELECT departed_at FROM loads WHERE id = ?', p.load_id))?.departed_at : null;
  return {
    tracking_code: p.tracking_code,
    status: p.status,
    from: p.origin,
    to: p.stop_name,
    route: p.route_name,
    receiver: firstNameAndInitial(p.receiver_name),
    sender: firstNameAndInitial(p.sender_name),
    plate: p.plate,
    expected_at: expected,
    events: [
      { what: 'Recorded at the office', at: p.created_at },
      p.paid_at && { what: 'Paid, waiting for a car', at: p.paid_at },
      p.loaded_at && { what: `Loaded onto ${p.plate}`, at: p.loaded_at },
      left && { what: `Left ${p.origin}`, at: left },
      p.arrived_at && { what: `Arrived at ${p.stop_name}`, at: p.arrived_at },
      p.collected_at && { what: 'Collected by the receiver', at: p.collected_at },
      p.cancelled_at && { what: 'Cancelled', at: p.cancelled_at },
    ]
      .filter(Boolean)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
  };
}
