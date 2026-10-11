// Passengers taking wallet money back to M-Pesa (e.g. before deleting their account). The money only ever
// goes to the passenger's own registered number. The wallet is debited when they ask; if the money can't be
// sent it goes straight back into the wallet. When automatic M-Pesa payouts (B2C) aren't set up, the office
// sends it by hand and records the M-Pesa code, just like owner payouts.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, insertId, NOW, tx } from '../db.js';
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

export const getWithdrawal = (id) => db.prepare(`${WITHDRAWAL_SELECT} WHERE w.id = ?`).get(id);
export const walletReference = (withdrawalId) => `W${withdrawalId}`;

export function requestWithdrawal(user, amount) {
  if (amount < config.minWithdrawal) throw new HttpError(400, 'AMOUNT_TOO_SMALL', `The smallest withdrawal is ${kesText(config.minWithdrawal)}.`);
  const withdrawal = tx(() => {
    if (db.prepare(`SELECT 1 FROM withdrawals WHERE user_id = ? AND status IN ('processing', 'manual')`).get(user.id)) {
      throw new HttpError(409, 'WITHDRAWAL_IN_PROGRESS', 'Your last withdrawal is still being sent. Please wait for it to finish.');
    }
    const [from, to] = nairobiDayRange(nairobiToday());
    const today = db.prepare('SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND created_at >= ? AND created_at < ?').get(user.id, from, to).n;
    if (today >= config.maxWithdrawalsPerDay) {
      throw new HttpError(429, 'TOO_MANY_WITHDRAWALS', `You can withdraw ${config.maxWithdrawalsPerDay} times a day. Please try again tomorrow.`);
    }
    const auto = mpesa.isConfigured.b2c;
    const id = insertId(
      db
        .prepare('INSERT INTO withdrawals (user_id, phone, amount, status, conversation_id) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, user.phone, amount, auto ? 'processing' : 'manual', randomUUID()),
    );
    // Throws "not enough money" (and undoes everything) if the wallet is short.
    postWalletEntry(user.id, { type: 'withdrawal', amount: -amount, reference: walletReference(id), description: 'Withdrawal to M-Pesa' });
    return getWithdrawal(id);
  });

  if (withdrawal.status === 'manual') {
    notifyOffice({
      kind: 'withdrawal.manual',
      title: `Send ${kesText(amount)} to passenger ${withdrawal.passenger_name}`,
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
    db.prepare('UPDATE withdrawals SET provider_reference = ? WHERE id = ?').run(providerReference, withdrawal.id);
    if (mpesa.isMock) handleWithdrawalResult(mpesa.mockB2cResult({ originatorConversationId: withdrawal.conversation_id }).Result);
  } catch (err) {
    if (err.rejected) {
      failWithdrawal(withdrawal.id, `M-Pesa refused the payment: ${err.message}`);
    } else {
      // Network problem: M-Pesa may still have sent it, so the wallet is not refilled automatically.
      db.prepare('UPDATE withdrawals SET result_desc = ? WHERE id = ?').run(`Result unknown (${err.message}). Check the M-Pesa statement.`, withdrawal.id);
      notifyOffice({
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
export function completeWithdrawal(withdrawalId, reference, officeUserId = null) {
  const withdrawal = tx(() => {
    const w = getWithdrawal(withdrawalId);
    if (!w) throw notFound('Withdrawal');
    if (!OPEN.includes(w.status)) throw new HttpError(409, 'WITHDRAWAL_FINISHED', `This withdrawal is already ${w.status}`);
    db.prepare(`UPDATE withdrawals SET status = 'completed', reference = ?, handled_by = ?, completed_at = ${NOW} WHERE id = ?`).run(reference, officeUserId, withdrawalId);
    return getWithdrawal(withdrawalId);
  });
  notify([withdrawal.user_id], {
    kind: 'withdrawal.completed',
    title: `${kesText(withdrawal.amount)} sent to your M-Pesa`,
    body: `Sent to ${displayPhone(withdrawal.phone)}. M-Pesa code ${reference}.`,
    target: 'withdrawals',
  });
  return withdrawal;
}

/** The money could not be sent: it goes back into the passenger's wallet. */
export function failWithdrawal(withdrawalId, reason, officeUserId = null) {
  const withdrawal = tx(() => {
    const w = getWithdrawal(withdrawalId);
    if (!w) throw notFound('Withdrawal');
    if (!OPEN.includes(w.status)) throw new HttpError(409, 'WITHDRAWAL_FINISHED', `This withdrawal is already ${w.status}`);
    db.prepare(`UPDATE withdrawals SET status = 'failed', result_desc = ?, handled_by = ?, completed_at = ${NOW} WHERE id = ?`).run(reason, officeUserId, withdrawalId);
    postWalletEntry(w.user_id, { type: 'withdrawal_reversal', amount: w.amount, reference: walletReference(w.id), description: `Withdrawal not sent: ${reason}` });
    return getWithdrawal(withdrawalId);
  });
  notify([withdrawal.user_id], {
    kind: 'withdrawal.failed',
    title: `Withdrawal of ${kesText(withdrawal.amount)} not sent`,
    body: `${reason}. The money is back in your wallet.`,
    target: 'withdrawals',
  });
  return withdrawal;
}

/**
 * M-Pesa's answer for a withdrawal (a B2C result whose id isn't an owner payout). Returns false if the id
 * isn't a withdrawal. Safe to receive more than once.
 */
export function handleWithdrawalResult(result) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE conversation_id = ?').get(result.OriginatorConversationID);
  if (!w) return false;
  if (w.status !== 'processing') return true;
  const ok = Number(result.ResultCode) === 0;
  if (ok) completeWithdrawal(w.id, String(result.TransactionID));
  else failWithdrawal(w.id, String(result.ResultDesc ?? 'M-Pesa payment failed'));
  audit(null, ok ? 'withdrawal.confirmed' : 'withdrawal.failed', 'withdrawals', w.id, { amount: w.amount, result: result.ResultDesc ?? null });
  return true;
}

export function handleWithdrawalTimeout(conversationId) {
  db.prepare("UPDATE withdrawals SET result_desc = 'M-Pesa timed out. Check the M-Pesa statement.' WHERE conversation_id = ? AND status = 'processing'").run(conversationId);
}

/** Asks the provider about withdrawals still processing (IntaSend reports this way; Daraja uses callbacks). */
export async function reconcileProcessingWithdrawals() {
  for (const w of db.prepare("SELECT * FROM withdrawals WHERE status = 'processing' AND provider_reference IS NOT NULL").all()) {
    try {
      const result = await mpesa.b2cStatus(w.provider_reference);
      if (result) handleWithdrawalResult({ ...result, OriginatorConversationID: w.conversation_id });
    } catch (err) {
      console.error(`[withdrawals] status check for withdrawal #${w.id} failed:`, err.message);
    }
  }
}
