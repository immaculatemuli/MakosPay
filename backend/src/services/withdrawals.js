// Passengers taking wallet money back to M-Pesa (e.g. before deleting their account). The money only ever
// goes to the passenger's own registered number. The wallet is debited when they ask; if the money can't be
// sent it goes straight back into the wallet. When automatic M-Pesa payouts (B2C) aren't set up, the office
// sends it by hand and records the M-Pesa code, just like owner payouts.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiDayRange, nairobiToday } from '../util.js';
import { audit } from './audit.js';
import * as mpesa from './mpesa.js';
import { kesText, notify, notifyOffice } from './notifications.js';
import { postWalletEntry } from './wallet.js';

export const OPEN = ['processing', 'manual'];
export const WITHDRAWAL_SELECT = `
  SELECT w.*, u.name AS passenger_name, h.name AS handled_by_name
  FROM withdrawals w JOIN users u ON u.id = w.user_id LEFT JOIN users h ON h.id = w.handled_by`;

export const getWithdrawal = (id) => db.get(`${WITHDRAWAL_SELECT} WHERE w.id = ?`, id);
export const walletReference = (withdrawalId) => `W${withdrawalId}`;

export async function requestWithdrawal(user, amount) {
  if (amount < config.minWithdrawal) throw new HttpError(400, 'AMOUNT_TOO_SMALL', `The smallest withdrawal is ${kesText(config.minWithdrawal)}.`);
  const withdrawal = await tx(async () => {
    if (await db.get(`SELECT 1 FROM withdrawals WHERE user_id = ? AND status IN ('processing', 'manual')`, user.id)) {
      throw new HttpError(409, 'WITHDRAWAL_IN_PROGRESS', 'Your last withdrawal is still being sent. Please wait for it to finish.');
    }
    const [from, to] = nairobiDayRange(nairobiToday());
    const today = (await db.get('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND created_at >= ? AND created_at < ?', user.id, from, to)).n;
    if (today >= config.maxWithdrawalsPerDay) {
      throw new HttpError(429, 'TOO_MANY_WITHDRAWALS', `You can withdraw ${config.maxWithdrawalsPerDay} times a day. Please try again tomorrow.`);
    }
    return createWithdrawal(user, amount, 'Withdrawal to M-Pesa');
  });
  return dispatchWithdrawal(withdrawal);
}

/**
 * Takes `amount` from the passenger's wallet to send to their own M-Pesa number (no limits: also used for refunds
 * the system makes, e.g. a cancelled seat booking). Must run inside tx(); then call dispatchWithdrawal.
 */
export async function createWithdrawal(user, amount, description) {
  const id = await db.insert(
    'INSERT INTO withdrawals (user_id, phone, amount, status, conversation_id) VALUES (?, ?, ?, ?, ?)',
    user.id,
    user.phone,
    amount,
    mpesa.isConfigured.b2c ? 'processing' : 'manual',
    randomUUID(),
  );
  // Throws "not enough money" (and undoes everything) if the wallet is short.
  await postWalletEntry(user.id, { type: 'withdrawal', amount: -amount, reference: walletReference(id), description });
  return getWithdrawal(id);
}

/** Sends a created withdrawal by M-Pesa, or (no automatic payouts set up) asks the office to send it by hand. */
export async function dispatchWithdrawal(withdrawal) {
  if (withdrawal.status === 'manual') {
    await notifyOffice({
      kind: 'withdrawal.manual',
      title: `Send ${kesText(withdrawal.amount)} to passenger ${withdrawal.passenger_name}`,
      body: `Wallet withdrawal to ${displayPhone(withdrawal.phone)}. Send it by M-Pesa, then record the M-Pesa code.`,
      target: 'withdrawals',
    });
    return withdrawal;
  }
  return sendByMpesa(withdrawal);
}

async function sendByMpesa(withdrawal) {
  try {
    const { providerReference } = await mpesa.b2cPayment({
      originatorConversationId: withdrawal.conversation_id,
      phone: withdrawal.phone,
      name: withdrawal.passenger_name,
      amount: withdrawal.amount,
      remarks: 'FarePay wallet withdrawal',
      occasion: 'Wallet withdrawal',
    });
    await db.run('UPDATE withdrawals SET provider_reference = ? WHERE id = ?', providerReference, withdrawal.id);
    if (mpesa.isMock) await handleWithdrawalResult(mpesa.mockB2cResult({ originatorConversationId: withdrawal.conversation_id }).Result);
  } catch (err) {
    if (err.rejected) {
      await failWithdrawal(withdrawal.id, `M-Pesa refused the payment: ${err.message}`);
    } else {
      // Network problem: M-Pesa may still have sent it, so the wallet is not refilled automatically.
      await db.run('UPDATE withdrawals SET result_desc = ? WHERE id = ?', `Result unknown (${err.message}). Check the M-Pesa statement.`, withdrawal.id);
      await notifyOffice({
        kind: 'withdrawal.unknown',
        title: `Check a withdrawal of ${kesText(withdrawal.amount)}`,
        body: `M-Pesa did not answer for ${withdrawal.passenger_name}'s withdrawal. Check the M-Pesa statement, then mark it sent or failed.`,
        target: 'withdrawals',
      });
    }
  }
  return getWithdrawal(withdrawal.id);
}

const displayPhone = (phone) => (phone.startsWith('254') ? `0${phone.slice(3)}` : phone);

/** The money reached the passenger (M-Pesa confirmed, or the office sent it and recorded the code). */
export async function completeWithdrawal(withdrawalId, reference, officeUserId = null) {
  const withdrawal = await tx(async () => {
    const w = await getWithdrawal(withdrawalId);
    if (!w) throw notFound('Withdrawal');
    if (!OPEN.includes(w.status)) throw new HttpError(409, 'WITHDRAWAL_FINISHED', `This withdrawal is already ${w.status}`);
    await db.run(`UPDATE withdrawals SET status = 'completed', reference = ?, handled_by = ?, completed_at = ${NOW} WHERE id = ?`, reference, officeUserId, withdrawalId);
    return getWithdrawal(withdrawalId);
  });
  await notify([withdrawal.user_id], {
    kind: 'withdrawal.completed',
    title: `${kesText(withdrawal.amount)} sent to your M-Pesa`,
    body: `Sent to ${displayPhone(withdrawal.phone)}. M-Pesa code ${reference}.`,
    target: 'withdrawals',
  });
  return withdrawal;
}

/** The money could not be sent: it goes back into the passenger's wallet. */
export async function failWithdrawal(withdrawalId, reason, officeUserId = null) {
  const withdrawal = await tx(async () => {
    const w = await getWithdrawal(withdrawalId);
    if (!w) throw notFound('Withdrawal');
    if (!OPEN.includes(w.status)) throw new HttpError(409, 'WITHDRAWAL_FINISHED', `This withdrawal is already ${w.status}`);
    await db.run(`UPDATE withdrawals SET status = 'failed', result_desc = ?, handled_by = ?, completed_at = ${NOW} WHERE id = ?`, reason, officeUserId, withdrawalId);
    await postWalletEntry(w.user_id, { type: 'withdrawal_reversal', amount: w.amount, reference: walletReference(w.id), description: `Withdrawal not sent: ${reason}` });
    return getWithdrawal(withdrawalId);
  });
  await notify([withdrawal.user_id], {
    kind: 'withdrawal.failed',
    title: `Withdrawal of ${kesText(withdrawal.amount)} not sent`,
    body: `${reason}. The money is back in your wallet.`,
    target: 'withdrawals',
  });
  return withdrawal;
}

/**
 * M-Pesa's answer for a withdrawal (a B2C result whose id isn't an owner payout). Returns false if the id
 * isn't a withdrawal. Safe to receive more than once, even at the same moment.
 */
export async function handleWithdrawalResult(result) {
  const w = await db.get('SELECT * FROM withdrawals WHERE conversation_id = ?', result.OriginatorConversationID);
  if (!w) return false;
  if (w.status !== 'processing') return true;
  const ok = Number(result.ResultCode) === 0;
  try {
    if (ok) await completeWithdrawal(w.id, String(result.TransactionID));
    else await failWithdrawal(w.id, String(result.ResultDesc ?? 'M-Pesa payment failed'));
  } catch (err) {
    if (err.code === 'WITHDRAWAL_FINISHED') return true; // a copy of this result finished it a moment ago
    throw err;
  }
  await audit(null, ok ? 'withdrawal.confirmed' : 'withdrawal.failed', 'withdrawals', w.id, { amount: w.amount, result: result.ResultDesc ?? null });
  return true;
}

export async function handleWithdrawalTimeout(conversationId) {
  await db.run("UPDATE withdrawals SET result_desc = 'M-Pesa timed out. Check the M-Pesa statement.' WHERE conversation_id = ? AND status = 'processing'", conversationId);
}

/** Asks the provider about withdrawals still processing (IntaSend reports this way; Daraja uses callbacks). */
export async function reconcileProcessingWithdrawals() {
  for (const w of await db.all("SELECT * FROM withdrawals WHERE status = 'processing' AND provider_reference IS NOT NULL")) {
    try {
      const result = await mpesa.b2cStatus(w.provider_reference);
      if (result) await handleWithdrawalResult({ ...result, OriginatorConversationID: w.conversation_id });
    } catch (err) {
      console.error(`[withdrawals] status check for withdrawal #${w.id} failed:`, err.message);
    }
  }
}
