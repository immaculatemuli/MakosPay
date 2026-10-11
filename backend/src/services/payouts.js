// Paying vehicle owners: everything an owner is owed (their fares not yet paid out, minus fares refunded
// after they were paid) is sent in one payment to their M-Pesa or bank account, automatically once a day
// or when the SACCO office taps "Pay now".
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, insertId, NOW, tx } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiToday } from '../util.js';
import * as mpesa from './mpesa.js';

export const getPayout = (id) => db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);

/** Where an owner wants to be paid: from their most recently added vehicle. */
export function ownerDestination(ownerPhone) {
  const v = db
    .prepare('SELECT owner_payout_method, owner_bank_name, owner_bank_paybill, owner_bank_account FROM vehicles WHERE owner_phone = ? ORDER BY id DESC LIMIT 1')
    .get(ownerPhone);
  if (v?.owner_payout_method === 'bank') {
    return { method: 'bank', bank_name: v.owner_bank_name, bank_paybill: v.owner_bank_paybill, bank_account: v.owner_bank_account };
  }
  return { method: 'mpesa', bank_name: null, bank_paybill: null, bank_account: null };
}

/** One owner's unpaid fares minus refunds taken back from earlier payouts. */
function owedTo(ownerPhone) {
  const fares = db
    .prepare(
      "SELECT MAX(owner_name) AS owner_name, COALESCE(SUM(fare), 0) AS fares, COUNT(*) AS trip_count FROM trips WHERE owner_phone = ? AND status = 'paid' AND payout_id IS NULL",
    )
    .get(ownerPhone);
  const deducted = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM owner_deductions WHERE owner_phone = ? AND payout_id IS NULL').get(ownerPhone).n;
  return { ...fares, deducted, amount: fares.fares - deducted };
}

/** What each owner is owed right now (more than zero), with the vehicles the fares came from and how they're paid. */
export function owedByOwner() {
  const owners = db
    .prepare(
      `SELECT t.owner_phone, GROUP_CONCAT(DISTINCT v.plate) AS plates
       FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.status = 'paid' AND t.payout_id IS NULL GROUP BY t.owner_phone`,
    )
    .all();
  return owners
    .map((o) => ({ owner_phone: o.owner_phone, ...owedTo(o.owner_phone), plates: o.plates ? o.plates.split(',') : [], ...ownerDestination(o.owner_phone) }))
    .filter((o) => o.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Sends one owner everything they are owed, to their M-Pesa or their bank account. The fares (and any
 * refund deductions) are marked as paid out straight away so they can't be sent twice; if the payment
 * fails they become unpaid again. Without automatic payouts set up (or with `manual`), the payout waits
 * for the office to send the money itself and record the M-Pesa code.
 */
export async function createPayout(ownerPhone, adminId, { manual = false } = {}) {
  const auto = !manual && mpesa.isConfigured.b2c;
  const payout = tx(() => {
    const owed = owedTo(ownerPhone);
    if (owed.amount <= 0) throw new HttpError(409, 'NOTHING_TO_PAY', 'This owner has no fares waiting to be paid');
    const dest = ownerDestination(ownerPhone);
    const id = insertId(
      db
        .prepare(
          `INSERT INTO payouts (owner_name, owner_phone, amount, trip_count, status, conversation_id, created_by, method, bank_name, bank_paybill, bank_account)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          owed.owner_name,
          ownerPhone,
          owed.amount,
          owed.trip_count,
          auto ? 'processing' : 'manual',
          randomUUID(),
          adminId,
          dest.method,
          dest.bank_name,
          dest.bank_paybill,
          dest.bank_account,
        ),
    );
    db.prepare("UPDATE trips SET payout_id = ? WHERE owner_phone = ? AND status = 'paid' AND payout_id IS NULL").run(id, ownerPhone);
    db.prepare('UPDATE owner_deductions SET payout_id = ? WHERE owner_phone = ? AND payout_id IS NULL').run(id, ownerPhone);
    return getPayout(id);
  });

  if (payout.status === 'processing') {
    const plates = db.prepare('SELECT DISTINCT v.plate FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.payout_id = ?').all(payout.id);
    // Shown on the business M-Pesa statement.
    const remarks = `FarePay ${plates.map((p) => p.plate).join(' ')}`.slice(0, 100);
    try {
      const { providerReference, originatorConversationId } =
        payout.method === 'bank'
          ? await mpesa.b2bPayment({
              originatorConversationId: payout.conversation_id,
              paybill: payout.bank_paybill,
              accountReference: payout.bank_account,
              name: payout.owner_name,
              amount: payout.amount,
              remarks,
            })
          : await mpesa.b2cPayment({
              originatorConversationId: payout.conversation_id,
              phone: payout.owner_phone,
              name: payout.owner_name,
              amount: payout.amount,
              remarks,
            });
      db.prepare('UPDATE payouts SET provider_reference = ? WHERE id = ?').run(providerReference, payout.id);
      if (originatorConversationId && originatorConversationId !== payout.conversation_id) {
        // Daraja B2B chose its own id: store it so the result callback finds this payout.
        db.prepare('UPDATE payouts SET conversation_id = ? WHERE id = ?').run(originatorConversationId, payout.id);
        payout.conversation_id = originatorConversationId;
      }
      if (mpesa.isMock) handleB2cResult(mpesa.mockB2cResult({ originatorConversationId: payout.conversation_id }));
    } catch (err) {
      if (err.rejected) {
        failPayout(payout.id, `M-Pesa refused the payment: ${err.message}`);
      } else {
        // Network problem: M-Pesa may still have sent the money, so don't put the fares back automatically.
        db.prepare('UPDATE payouts SET result_desc = ? WHERE id = ?').run(`Result unknown (${err.message}). Check the M-Pesa statement.`, payout.id);
      }
    }
  }
  return getPayout(payout.id);
}

export function completePayout(payoutId, reference) {
  return tx(() => {
    const payout = getPayout(payoutId);
    if (!payout) throw notFound('Payout');
    if (!['processing', 'manual'].includes(payout.status)) throw new HttpError(409, 'PAYOUT_FINISHED', `This payout is already ${payout.status}`);
    db.prepare(`UPDATE payouts SET status = 'completed', reference = ?, completed_at = ${NOW} WHERE id = ?`).run(reference, payoutId);
    return getPayout(payoutId);
  });
}

/** The money did not reach the owner: the fares go back to "owed" and will be in the next payout. */
export function failPayout(payoutId, reason) {
  return tx(() => {
    const payout = getPayout(payoutId);
    if (!payout) throw notFound('Payout');
    if (!['processing', 'manual'].includes(payout.status)) throw new HttpError(409, 'PAYOUT_FINISHED', `This payout is already ${payout.status}`);
    db.prepare(`UPDATE payouts SET status = 'failed', result_desc = ?, completed_at = ${NOW} WHERE id = ?`).run(reason, payoutId);
    // Refunds of fares that were in this payout: the owner never got those fares, so nothing to take back.
    db.prepare('DELETE FROM owner_deductions WHERE trip_id IN (SELECT id FROM trips WHERE payout_id = ?)').run(payoutId);
    // Refunds this payout was taking back from earlier payouts: still to be taken from the next one.
    db.prepare('UPDATE owner_deductions SET payout_id = NULL WHERE payout_id = ?').run(payoutId);
    db.prepare('UPDATE trips SET payout_id = NULL WHERE payout_id = ?').run(payoutId);
    return getPayout(payoutId);
  });
}

/** M-Pesa's answer to a payout (Safaricom's callback, or IntaSend's status). Safe to receive more than once. */
export function handleB2cResult(body) {
  const result = body?.Result;
  if (!result?.OriginatorConversationID) return;
  const payout = db.prepare('SELECT * FROM payouts WHERE conversation_id = ?').get(result.OriginatorConversationID);
  if (!payout || payout.status !== 'processing') return;
  if (Number(result.ResultCode) === 0) completePayout(payout.id, String(result.TransactionID));
  else failPayout(payout.id, String(result.ResultDesc ?? 'M-Pesa payment failed'));
}

/** M-Pesa's queue timed out: the outcome is unknown, so leave it for the office to check. */
export function handleB2cTimeout(body) {
  const id = body?.Result?.OriginatorConversationID ?? body?.OriginatorConversationID;
  if (!id) return;
  db.prepare("UPDATE payouts SET result_desc = 'M-Pesa timed out. Check the M-Pesa statement.' WHERE conversation_id = ? AND status = 'processing'").run(id);
}

/** Asks the provider about payouts still processing (IntaSend reports this way; Daraja uses callbacks). */
export async function reconcileProcessingPayouts() {
  for (const payout of db.prepare("SELECT * FROM payouts WHERE status = 'processing' AND provider_reference IS NOT NULL").all()) {
    try {
      const result = await mpesa.b2cStatus(payout.provider_reference);
      if (result) handleB2cResult({ Result: { ...result, OriginatorConversationID: payout.conversation_id } });
    } catch (err) {
      console.error(`[payouts] status check for payout #${payout.id} failed:`, err.message);
    }
  }
}

/** Pays every owner who is owed something. Used by the daily run and by "Pay everyone now". */
export async function payEveryone(adminId = null) {
  const results = [];
  for (const owner of owedByOwner()) {
    try {
      results.push(await createPayout(owner.owner_phone, adminId));
    } catch (err) {
      if (err.code !== 'NOTHING_TO_PAY') console.error(`[payouts] paying ${owner.owner_phone} failed:`, err.message);
    }
  }
  return results;
}

/** Runs payEveryone once a day after PAYOUT_DAILY_AT (Kenyan time), remembering the last run across restarts. */
export function startDailyPayouts() {
  const [hh, mm] = config.payoutDailyAt.split(':').map(Number);
  let running = false;
  setInterval(async () => {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000); // Kenya is UTC+3
    const due = now.getUTCHours() * 60 + now.getUTCMinutes() >= hh * 60 + mm;
    const today = nairobiToday();
    if (running || !due || db.prepare("SELECT last_run FROM job_runs WHERE name = 'daily_payouts'").get()?.last_run === today) return;
    running = true;
    try {
      db.prepare("INSERT INTO job_runs (name, last_run) VALUES ('daily_payouts', ?) ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run").run(today);
      const paid = await payEveryone();
      console.log(`[payouts] daily payouts for ${today}: ${paid.length} owner(s)`);
    } catch (err) {
      console.error('[payouts] daily payouts failed:', err.message);
    } finally {
      running = false;
    }
  }, 60_000);
}
