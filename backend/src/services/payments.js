// M-Pesa payments from passengers: wallet top-ups, and fares paid directly when the wallet is short.
// Nothing is credited until M-Pesa confirms. Confirmation comes from Safaricom's callback, or from asking
// Safaricom (while the app waits, and every 30 seconds in the background), so it works without a public URL.
import { config } from '../config.js';
import { db, insertId, NOW, tx } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import * as mpesa from './mpesa.js';
import { checkFare, findTrip, getTrip, recordTrip } from './trips.js';
import { getBalance, postWalletEntry } from './wallet.js';

// STK query result codes that mean the passenger has not finished paying yet.
const STILL_PROCESSING = new Set(['4999']);

export const getPayment = (id) => db.prepare('SELECT * FROM mpesa_payments WHERE id = ?').get(id);

// Wallet reference until the M-Pesa receipt number is known.
const placeholderRef = (paymentId) => `MPESA-${paymentId}`;

function requireMpesa() {
  if (!mpesa.isConfigured.stk) throw new HttpError(503, 'MPESA_NOT_CONFIGURED', 'M-Pesa payments are not set up yet. Please try again later.');
}

/** Sends the PIN prompt for a wallet top-up. */
export async function startTopup(userId, { amount, phone }) {
  requireMpesa();
  if (amount < config.minTopup || amount > config.maxTopup) {
    throw new HttpError(400, 'INVALID_AMOUNT', `Top up between KES ${config.minTopup} and KES ${config.maxTopup}`);
  }
  if (getBalance(userId) + amount > config.maxWalletBalance) {
    throw new HttpError(400, 'WALLET_LIMIT', `Your wallet can hold at most KES ${config.maxWalletBalance}`);
  }
  // Recorded first, so a fast confirmation can never arrive for a payment we don't know about.
  const id = insertId(
    db.prepare("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status) VALUES (?, ?, ?, 'wallet', 'initiating')").run(userId, phone, amount),
  );
  await sendPrompt(id, { phone, amount, accountReference: `FAREPAY${userId}`, description: 'Wallet top-up' });
  return getPayment(id);
}

/**
 * Sends the PIN prompt for one fare (wallet too low). The ticket is issued when M-Pesa confirms, for the
 * vehicle, drop-off and fare the passenger confirmed. Returns { payment } while waiting, or { trip } if
 * this confirmation was already paid. Retries of the same confirmation never send a second prompt.
 */
export async function startFarePayment(userId, { qr, stopId, expectedFare, idempotencyKey, phone }) {
  requireMpesa();
  const trip = findTrip(userId, idempotencyKey);
  if (trip) return { trip };
  const previous = db
    .prepare("SELECT * FROM mpesa_payments WHERE user_id = ? AND idempotency_key = ? AND status IN ('initiating', 'pending', 'completed')")
    .get(userId, idempotencyKey);
  if (previous) return { payment: previous };

  const { vehicle, stop } = checkFare(qr, stopId, expectedFare);
  const id = insertId(
    db
      .prepare(
        `INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, vehicle_id, stop_id, idempotency_key)
         VALUES (?, ?, ?, 'fare', 'initiating', ?, ?, ?)`,
      )
      .run(userId, phone, stop.app_fare, vehicle.id, stop.id, idempotencyKey),
  );
  await sendPrompt(id, { phone, amount: stop.app_fare, accountReference: vehicle.plate.replace(/\W/g, ''), description: 'Fare' });
  return { payment: getPayment(id) };
}

async function sendPrompt(id, { phone, amount, accountReference, description }) {
  let response;
  try {
    response = await mpesa.stkPush({ phone, amount, accountReference, description });
  } catch (err) {
    console.error('[mpesa] PIN prompt failed:', err.message);
    db.prepare("UPDATE mpesa_payments SET status = 'failed', result_desc = ? WHERE id = ?").run(String(err.message), id);
    throw new HttpError(502, 'MPESA_UNAVAILABLE', 'Could not reach M-Pesa. Please try again.');
  }
  db.prepare("UPDATE mpesa_payments SET status = 'pending', checkout_request_id = ?, merchant_request_id = ? WHERE id = ?").run(
    response.CheckoutRequestID,
    response.MerchantRequestID,
    id,
  );
  // Tests only: pretend the passenger entered their PIN.
  if (mpesa.isMock) handleStkCallback(mpesa.mockStkCallback({ checkoutRequestId: response.CheckoutRequestID, amount, phone }));
}

/**
 * A confirmed fare: the M-Pesa money goes into the wallet and straight back out for the fare, so the
 * wallet history always adds up. Runs inside the confirmation's transaction.
 */
function completeFare(payment, receipt) {
  postWalletEntry(payment.user_id, {
    type: 'topup',
    amount: payment.amount,
    reference: receipt ?? placeholderRef(payment.id),
    description: 'M-Pesa payment for fare',
  });
  // Paid from the wallet meanwhile with the same confirmation: keep this money in the wallet.
  if (findTrip(payment.user_id, payment.idempotency_key)) return;
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(payment.vehicle_id);
  const stop = db.prepare('SELECT * FROM route_stops WHERE id = ?').get(payment.stop_id);
  const tripId = recordTrip({ passengerId: payment.user_id, vehicle, stop, fare: payment.amount, idempotencyKey: payment.idempotency_key });
  db.prepare('UPDATE mpesa_payments SET trip_id = ? WHERE id = ?').run(tripId, payment.id);
}

/** Handles M-Pesa's answer (Safaricom's callback, or one built from asking Safaricom). Safe to receive more than once. */
export function handleStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return;

  tx(() => {
    const payment = db.prepare('SELECT * FROM mpesa_payments WHERE checkout_request_id = ?').get(cb.CheckoutRequestID);
    if (!payment) {
      console.warn('[mpesa] confirmation for an unknown payment', JSON.stringify(cb));
      return;
    }
    const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
    const receipt = items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : null;
    const success = Number(cb.ResultCode) === 0;

    // Already confirmed by asking Safaricom: just record the receipt number that only the callback carries.
    if (payment.status === 'completed' && success && receipt && !payment.mpesa_receipt) {
      db.prepare('UPDATE mpesa_payments SET mpesa_receipt = ? WHERE id = ?').run(receipt, payment.id);
      db.prepare('UPDATE wallet_transactions SET reference = ? WHERE user_id = ? AND reference = ?').run(receipt, payment.user_id, placeholderRef(payment.id));
      return;
    }
    if (payment.status !== 'pending') return;

    if (!success) {
      db.prepare(`UPDATE mpesa_payments SET status = 'failed', result_desc = ?, completed_at = ${NOW} WHERE id = ?`).run(
        String(cb.ResultDesc ?? 'Payment not completed'),
        payment.id,
      );
      return;
    }

    db.prepare(`UPDATE mpesa_payments SET status = 'completed', mpesa_receipt = ?, result_desc = ?, completed_at = ${NOW} WHERE id = ?`).run(
      receipt,
      String(cb.ResultDesc ?? 'Success'),
      payment.id,
    );
    if (payment.purpose === 'fare') {
      completeFare(payment, receipt);
    } else {
      // Credit what we asked for: the passenger cannot change the amount in the PIN prompt.
      postWalletEntry(payment.user_id, {
        type: 'topup',
        amount: payment.amount,
        reference: receipt ?? placeholderRef(payment.id),
        description: 'M-Pesa top-up',
      });
    }
  });
}

/** If a payment is still pending, asks M-Pesa for the outcome (at most every few seconds per payment). */
export async function refreshPayment(payment) {
  if (mpesa.isMock || payment.status !== 'pending' || !payment.checkout_request_id) return payment;
  const wait = config.mpesa.queryIntervalMs;
  if (wait > 0 && payment.last_queried_at && Date.now() - Date.parse(payment.last_queried_at) < wait) return payment;

  db.prepare(`UPDATE mpesa_payments SET last_queried_at = ${NOW} WHERE id = ?`).run(payment.id);
  let result;
  try {
    result = await mpesa.stkQuery(payment.checkout_request_id);
  } catch {
    return getPayment(payment.id); // usually "being processed": the passenger hasn't entered their PIN yet
  }
  // 4999 "still under processing" is not an outcome: keep waiting.
  if (result.ResultCode !== undefined && !STILL_PROCESSING.has(String(result.ResultCode))) {
    handleStkCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: payment.checkout_request_id,
          ResultCode: result.ResultCode,
          ResultDesc: result.ResultDesc,
          ...(result.MpesaReceiptNumber && { CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: result.MpesaReceiptNumber }] } }),
        },
      },
    });
  }
  return getPayment(payment.id);
}

/**
 * Background safety net: confirms every pending payment, so a passenger who closes the app after entering
 * their PIN is still credited. PIN prompts expire within minutes, so one with no outcome after
 * `expireAfterMs` never went through.
 */
export async function reconcilePendingPayments({ expireAfterMs = config.mpesa.pendingExpiryMs } = {}) {
  for (const payment of db.prepare("SELECT * FROM mpesa_payments WHERE status = 'pending'").all()) {
    const current = await refreshPayment(payment);
    if (current.status === 'pending' && Date.now() - Date.parse(current.created_at) > expireAfterMs) {
      db.prepare(
        `UPDATE mpesa_payments SET status = 'failed', result_desc = 'No answer from M-Pesa (expired)', completed_at = ${NOW}
         WHERE id = ? AND status = 'pending'`,
      ).run(current.id);
    }
  }
}

/** A passenger's own payment, refreshed, with the ticket once a fare is confirmed. */
export async function getUserPayment(userId, paymentId) {
  const payment = getPayment(paymentId);
  if (!payment || payment.user_id !== userId) throw notFound('Payment');
  const current = await refreshPayment(payment);
  return { payment: current, trip: current.trip_id ? getTrip(current.trip_id) : null };
}
