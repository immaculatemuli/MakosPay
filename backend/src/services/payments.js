// M-Pesa payments from passengers: wallet top-ups, and fares paid directly when the wallet is short.
// Nothing is credited until M-Pesa confirms. Confirmation comes from Safaricom's callback, or from asking
// Safaricom (while the app waits, and every 30 seconds in the background), so it works without a public URL.
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import * as mpesa from './mpesa.js';
import { kesText, notify } from './notifications.js';
import { handleParcelStkCallback, reconcileParcelPayments } from './parcels.js';
import { checkFare, findTrip, getTrip, recordTrip } from './trips.js';
import { getBalance, postWalletEntry } from './wallet.js';

// What an M-Pesa payment that never got an answer is marked with (a late "success" can still complete it).
const EXPIRED = 'No answer from M-Pesa (expired)';

// STK query result codes that mean the passenger has not finished paying yet.
const STILL_PROCESSING = new Set(['4999']);

export const getPayment = (id) => db.get('SELECT * FROM mpesa_payments WHERE id = ?', id);

// Wallet reference until the M-Pesa receipt number is known.
const placeholderRef = (paymentId) => `MPESA-${paymentId}`;

/** Tells the passenger an M-Pesa payment didn't go through (they may have closed the app while waiting). */
function notifyTopupFailed(payment, reason) {
  const fare = payment.purpose === 'fare';
  return notify([payment.user_id], {
    kind: fare ? 'fare_mpesa.failed' : 'topup.failed',
    title: fare ? `M-Pesa fare payment of ${kesText(payment.amount)} not completed` : `Top-up of ${kesText(payment.amount)} not completed`,
    body: `${reason}. No money was taken${fare ? ' and no ticket was issued' : ''}. You can try again.`,
    target: fare ? 'trips' : 'wallet',
  });
}

export function requireMpesa() {
  if (!mpesa.isConfigured.stk) throw new HttpError(503, 'MPESA_NOT_CONFIGURED', 'M-Pesa payments are not set up yet. Please try again later.');
}

/** Sends the PIN prompt for a wallet top-up. */
export async function startTopup(userId, { amount, phone }) {
  requireMpesa();
  if (amount < config.minTopup || amount > config.maxTopup) {
    throw new HttpError(400, 'INVALID_AMOUNT', `Top up between KES ${config.minTopup} and KES ${config.maxTopup}`);
  }
  if ((await getBalance(userId)) + amount > config.maxWalletBalance) {
    throw new HttpError(400, 'WALLET_LIMIT', `Your wallet can hold at most KES ${config.maxWalletBalance}`);
  }
  // Recorded first, so a fast confirmation can never arrive for a payment we don't know about.
  const id = await db.insert("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status) VALUES (?, ?, ?, 'wallet', 'initiating')", userId, phone, amount);
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
  const trip = await findTrip(userId, idempotencyKey);
  if (trip) return { trip };
  const previous = await db.get(
    "SELECT * FROM mpesa_payments WHERE user_id = ? AND idempotency_key = ? AND status IN ('initiating', 'pending', 'completed')",
    userId,
    idempotencyKey,
  );
  if (previous) return { payment: previous };

  const { vehicle, stop } = await checkFare(qr, stopId, expectedFare);
  const id = await db.insert(
    `INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, vehicle_id, stop_id, idempotency_key)
     VALUES (?, ?, ?, 'fare', 'initiating', ?, ?, ?)`,
    userId,
    phone,
    stop.app_fare,
    vehicle.id,
    stop.id,
    idempotencyKey,
  );
  await sendPrompt(id, { phone, amount: stop.app_fare, accountReference: vehicle.plate.replace(/\W/g, ''), description: 'Fare' });
  return { payment: await getPayment(id) };
}

/** Sends the PIN prompt for a payment row already recorded as 'initiating'. Used for wallet top-ups, fares and seat bookings. */
export async function sendPrompt(id, { phone, amount, accountReference, description }) {
  let response;
  try {
    response = await mpesa.stkPush({ phone, amount, accountReference, description });
  } catch (err) {
    // "fetch failed" alone says nothing: the cause says why (DNS, connection refused, reset, timeout...).
    const cause = err.cause ? ` (${[err.cause.code, err.cause.message].filter(Boolean).join(': ')})` : '';
    console.error('[mpesa] PIN prompt failed:', `${err.message}${cause}`);
    await db.run("UPDATE mpesa_payments SET status = 'failed', result_desc = ? WHERE id = ?", String(err.message), id);
    throw new HttpError(502, 'MPESA_UNAVAILABLE', 'Could not reach M-Pesa. Please try again.');
  }
  await db.run(
    "UPDATE mpesa_payments SET status = 'pending', checkout_request_id = ?, merchant_request_id = ? WHERE id = ?",
    response.CheckoutRequestID,
    response.MerchantRequestID,
    id,
  );
  // Tests only: pretend the passenger entered their PIN.
  if (mpesa.isMock) await handleStkCallback(mpesa.mockStkCallback({ checkoutRequestId: response.CheckoutRequestID, amount, phone }));
}

/**
 * A confirmed fare: the M-Pesa money goes into the wallet and straight back out for the fare, so the
 * wallet history always adds up. Runs inside the confirmation's transaction.
 */
async function completeFare(payment, receipt) {
  await postWalletEntry(payment.user_id, {
    type: 'topup',
    amount: payment.amount,
    reference: receipt ?? placeholderRef(payment.id),
    description: 'M-Pesa payment for fare',
  });
  // Paid from the wallet meanwhile with the same confirmation: keep this money in the wallet.
  if (await findTrip(payment.user_id, payment.idempotency_key)) return;
  const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ?', payment.vehicle_id);
  const stop = await db.get('SELECT * FROM route_stops WHERE id = ?', payment.stop_id);
  const tripId = await recordTrip({ passengerId: payment.user_id, vehicle, stop, fare: payment.amount, idempotencyKey: payment.idempotency_key });
  await db.run('UPDATE mpesa_payments SET trip_id = ? WHERE id = ?', tripId, payment.id);
}

/** Handles M-Pesa's answer (Safaricom's callback, or one built from asking Safaricom). Safe to receive more than once. */
export async function handleStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return;

  await tx(async () => {
    const payment = await db.get('SELECT * FROM mpesa_payments WHERE checkout_request_id = ?', cb.CheckoutRequestID);
    if (!payment) {
      // Not a passenger's payment: a parcel fee's, or unknown.
      if (!(await handleParcelStkCallback(cb))) console.warn('[mpesa] confirmation for an unknown payment', JSON.stringify(cb));
      return;
    }
    const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
    const receipt = items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : null;
    const success = Number(cb.ResultCode) === 0;

    // Already confirmed by asking Safaricom: just record the receipt number that only the callback carries.
    if (payment.status === 'completed' && success && receipt && !payment.mpesa_receipt) {
      await db.run('UPDATE mpesa_payments SET mpesa_receipt = ? WHERE id = ?', receipt, payment.id);
      await db.run('UPDATE wallet_transactions SET reference = ? WHERE user_id = ? AND reference = ?', receipt, payment.user_id, placeholderRef(payment.id));
      return;
    }
    // M-Pesa took the money after FarePay had given up waiting ("no answer"): the passenger paid, so the
    // money goes into their wallet. A late fare gets no ticket (they will have paid another way by then).
    if (payment.status === 'failed' && payment.result_desc === EXPIRED && success) {
      await db.run(
        `UPDATE mpesa_payments SET status = 'completed', mpesa_receipt = ?, result_desc = ?, completed_at = ${NOW} WHERE id = ?`,
        receipt,
        'Confirmed late by M-Pesa',
        payment.id,
      );
      await postWalletEntry(payment.user_id, {
        type: 'topup',
        amount: payment.amount,
        reference: receipt ?? placeholderRef(payment.id),
        description: payment.purpose === 'fare' ? 'M-Pesa fare payment confirmed late: added to your wallet' : 'M-Pesa top-up (confirmed late)',
      });
      await notify([payment.user_id], {
        kind: 'topup.completed',
        title: `${kesText(payment.amount)} added to your wallet`,
        body: `M-Pesa confirmed your payment late${receipt ? ` (receipt ${receipt})` : ''}, so it is in your wallet${payment.purpose === 'fare' ? ' instead of paying that fare' : ''}. Balance ${kesText(await getBalance(payment.user_id))}.`,
        target: 'wallet',
      });
      return;
    }
    if (payment.status !== 'pending') return;

    if (!success) {
      const reason = String(cb.ResultDesc ?? 'Payment not completed');
      await db.run(`UPDATE mpesa_payments SET status = 'failed', result_desc = ?, completed_at = ${NOW} WHERE id = ?`, reason, payment.id);
      await notifyTopupFailed(payment, reason);
      return;
    }

    await db.run(
      `UPDATE mpesa_payments SET status = 'completed', mpesa_receipt = ?, result_desc = ?, completed_at = ${NOW} WHERE id = ?`,
      receipt,
      String(cb.ResultDesc ?? 'Success'),
      payment.id,
    );
    if (payment.purpose === 'fare') {
      await completeFare(payment, receipt);
    } else {
      // Credit what we asked for: the passenger cannot change the amount in the PIN prompt.
      await postWalletEntry(payment.user_id, {
        type: 'topup',
        amount: payment.amount,
        reference: receipt ?? placeholderRef(payment.id),
        description: 'M-Pesa top-up',
      });
      await notify([payment.user_id], {
        kind: 'topup.completed',
        title: `${kesText(payment.amount)} added to your wallet`,
        body: `${receipt ? `M-Pesa receipt ${receipt}. ` : ''}Your balance is now ${kesText(await getBalance(payment.user_id))}.`,
        target: 'wallet',
      });
    }
  });
}

/** If a payment is still pending, asks M-Pesa for the outcome (at most every few seconds per payment). */
export async function refreshPayment(payment) {
  if (mpesa.isMock || payment.status !== 'pending' || !payment.checkout_request_id) return payment;
  const wait = config.mpesa.queryIntervalMs;
  if (wait > 0 && payment.last_queried_at && Date.now() - Date.parse(payment.last_queried_at) < wait) return payment;

  await db.run(`UPDATE mpesa_payments SET last_queried_at = ${NOW} WHERE id = ?`, payment.id);
  let result;
  try {
    result = await mpesa.stkQuery(payment.checkout_request_id);
  } catch {
    return getPayment(payment.id); // usually "being processed": the passenger hasn't entered their PIN yet
  }
  // 4999 "still under processing" is not an outcome: keep waiting.
  if (result.ResultCode !== undefined && !STILL_PROCESSING.has(String(result.ResultCode))) {
    await handleStkCallback({
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
  for (const payment of await db.all("SELECT * FROM mpesa_payments WHERE status = 'pending'")) {
    const current = await refreshPayment(payment);
    if (current.status === 'pending' && Date.now() - Date.parse(current.created_at) > expireAfterMs) {
      const expired = await db.run(
        `UPDATE mpesa_payments SET status = 'failed', result_desc = ?, completed_at = ${NOW}
         WHERE id = ? AND status = 'pending'`,
        EXPIRED,
        current.id,
      );
      if (expired.changes) await notifyTopupFailed(current, 'No answer from M-Pesa');
    }
  }
  await reconcileParcelPayments({ expireAfterMs });
}

/** A passenger's own payment, refreshed, with the ticket once a fare is confirmed. */
export async function getUserPayment(userId, paymentId) {
  const payment = await getPayment(paymentId);
  if (!payment || payment.user_id !== userId) throw notFound('Payment');
  const current = await refreshPayment(payment);
  return { payment: current, trip: current.trip_id ? await getTrip(current.trip_id) : null };
}
