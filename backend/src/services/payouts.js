// Paying vehicle owners: everything an owner is owed (their fares not yet paid out, minus fares refunded
// after they were paid) is sent in one payment to their M-Pesa or bank account, automatically once a day
// or when the SACCO office taps "Pay now".
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, NOW, sql, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiToday } from '../util.js';
import { audit } from './audit.js';
import { runDaily } from './jobs.js';
import * as mpesa from './mpesa.js';
import { kesText, notifyOffice } from './notifications.js';
import { queueSms } from './sms.js';

export const getPayout = (id) => db.get('SELECT * FROM payouts WHERE id = ?', id);

/** Where an owner wants to be paid: their owner record (else, for older data, their most recently added vehicle). */
export async function ownerDestination(ownerPhone) {
  const o = await db.get('SELECT payout_method, bank_name, bank_paybill, bank_account FROM owners WHERE phone = ?', ownerPhone);
  if (o) {
    return o.payout_method === 'bank'
      ? { method: 'bank', bank_name: o.bank_name, bank_paybill: o.bank_paybill, bank_account: o.bank_account }
      : { method: 'mpesa', bank_name: null, bank_paybill: null, bank_account: null };
  }
  const v = await db.get(
    'SELECT owner_payout_method, owner_bank_name, owner_bank_paybill, owner_bank_account FROM vehicles WHERE owner_phone = ? ORDER BY id DESC LIMIT 1',
    ownerPhone,
  );
  if (v?.owner_payout_method === 'bank') {
    return { method: 'bank', bank_name: v.owner_bank_name, bank_paybill: v.owner_bank_paybill, bank_account: v.owner_bank_account };
  }
  return { method: 'mpesa', bank_name: null, bank_paybill: null, bank_account: null };
}

/** One owner's unpaid fares minus refunds taken back from earlier payouts. */
async function owedTo(ownerPhone) {
  const fares = await db.get(
    "SELECT MAX(owner_name) AS owner_name, COALESCE(SUM(fare), 0) AS fares, COUNT(*) AS trip_count FROM trips WHERE owner_phone = ? AND status = 'paid' AND payout_id IS NULL",
    ownerPhone,
  );
  const deducted = (await db.get('SELECT COALESCE(SUM(amount), 0) AS n FROM owner_deductions WHERE owner_phone = ? AND payout_id IS NULL', ownerPhone)).n;
  return { ...fares, deducted, amount: fares.fares - deducted };
}

/** What each owner is owed right now (more than zero), with the vehicles the fares came from and how they're paid. */
export async function owedByOwner() {
  const owners = await db.all(
    `SELECT t.owner_phone, ${sql.distinctList('v.plate')} AS plates
     FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.status = 'paid' AND t.payout_id IS NULL GROUP BY t.owner_phone`,
  );
  const result = [];
  for (const o of owners) {
    result.push({ owner_phone: o.owner_phone, ...(await owedTo(o.owner_phone)), plates: o.plates ? o.plates.split(',') : [], ...(await ownerDestination(o.owner_phone)) });
  }
  return result.filter((o) => o.amount > 0).sort((a, b) => b.amount - a.amount);
}

/**
 * Sends one owner everything they are owed, to their M-Pesa or their bank account. The fares (and any
 * refund deductions) are marked as paid out straight away so they can't be sent twice; if the payment
 * fails they become unpaid again. Without automatic payouts set up (or with `manual`), the payout waits
 * for the office to send the money itself and record the M-Pesa code.
 */
export async function createPayout(ownerPhone, adminId, { manual = false } = {}) {
  const auto = !manual && mpesa.isConfigured.b2c;
  const payout = await tx(async () => {
    const owed = await owedTo(ownerPhone);
    if (owed.amount <= 0) throw new HttpError(409, 'NOTHING_TO_PAY', 'This owner has no fares waiting to be paid');
    const dest = await ownerDestination(ownerPhone);
    const id = await db.insert(
      `INSERT INTO payouts (owner_name, owner_phone, amount, trip_count, status, conversation_id, created_by, method, bank_name, bank_paybill, bank_account, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM owners WHERE phone = ?))`,
      (await db.get('SELECT name FROM owners WHERE phone = ?', ownerPhone))?.name ?? owed.owner_name,
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
      ownerPhone,
    );
    await db.run("UPDATE trips SET payout_id = ? WHERE owner_phone = ? AND status = 'paid' AND payout_id IS NULL", id, ownerPhone);
    await db.run('UPDATE owner_deductions SET payout_id = ? WHERE owner_phone = ? AND payout_id IS NULL', id, ownerPhone);
    return getPayout(id);
  });

  if (payout.status === 'processing') {
    const plates = await db.all('SELECT DISTINCT v.plate FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.payout_id = ? ORDER BY v.plate', payout.id);
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
      await db.run('UPDATE payouts SET provider_reference = ? WHERE id = ?', providerReference, payout.id);
      if (originatorConversationId && originatorConversationId !== payout.conversation_id) {
        // Daraja B2B chose its own id: store it so the result callback finds this payout.
        await db.run('UPDATE payouts SET conversation_id = ? WHERE id = ?', originatorConversationId, payout.id);
        payout.conversation_id = originatorConversationId;
      }
      if (mpesa.isMock) await handleB2cResult(mpesa.mockB2cResult({ originatorConversationId: payout.conversation_id }));
    } catch (err) {
      if (err.rejected) {
        await failAndAlert(payout, `M-Pesa refused the payment: ${err.message}`);
      } else {
        // Network problem: M-Pesa may still have sent the money, so don't put the fares back automatically.
        await db.run('UPDATE payouts SET result_desc = ? WHERE id = ?', `Result unknown (${err.message}). Check the M-Pesa statement.`, payout.id);
      }
    }
  }
  return getPayout(payout.id);
}

export function completePayout(payoutId, reference) {
  return tx(async () => {
    const payout = await getPayout(payoutId);
    if (!payout) throw notFound('Payout');
    if (!['processing', 'manual'].includes(payout.status)) throw new HttpError(409, 'PAYOUT_FINISHED', `This payout is already ${payout.status}`);
    await db.run(`UPDATE payouts SET status = 'completed', reference = ?, completed_at = ${NOW} WHERE id = ?`, reference, payoutId);
    if (config.ownerPayoutSms) await textOwner(payout, reference);
    return getPayout(payoutId);
  });
}

/**
 * Tells the owner by SMS what reached them and from which cars, e.g. "Makos Sacco: KES 20,400 sent to your M-Pesa
 * (QJK2X7). 86 fares from 5 cars: KDA 123A 4,000, ...". Saves the office "where is my money?" calls. Inside tx().
 */
async function textOwner(payout, reference) {
  const cars = await db.all(
    `SELECT v.plate, COUNT(*) AS fares, SUM(t.fare) AS total FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.payout_id = ? GROUP BY v.plate ORDER BY total DESC`,
    payout.id,
  );
  const shown = cars.slice(0, 6).map((c) => `${c.plate} ${c.total.toLocaleString('en-KE')}`);
  if (cars.length > 6) shown.push(`+${cars.length - 6} more`);
  const where = payout.method === 'bank' ? `your ${payout.bank_name ?? 'bank'} account` : 'your M-Pesa';
  const fares = cars.reduce((n, c) => n + c.fares, 0);
  const message =
    `${config.saccoName}: ${kesText(payout.amount)} sent to ${where} (${reference}). ` +
    (cars.length ? `${fares} fare${fares === 1 ? '' : 's'} from ${cars.length} car${cars.length === 1 ? '' : 's'}: ${shown.join(', ')}.` : 'Refund adjustments only.');
  await queueSms(payout.owner_phone, 'payout.owner', message);
}

/** The money did not reach the owner: the fares go back to "owed" and will be in the next payout. */
export function failPayout(payoutId, reason) {
  return tx(async () => {
    const payout = await getPayout(payoutId);
    if (!payout) throw notFound('Payout');
    if (!['processing', 'manual'].includes(payout.status)) throw new HttpError(409, 'PAYOUT_FINISHED', `This payout is already ${payout.status}`);
    await db.run(`UPDATE payouts SET status = 'failed', result_desc = ?, completed_at = ${NOW} WHERE id = ?`, reason, payoutId);
    // Refunds of fares that were in this payout: the owner never got those fares, so nothing to take back.
    await db.run('DELETE FROM owner_deductions WHERE trip_id IN (SELECT id FROM trips WHERE payout_id = ?)', payoutId);
    // Refunds this payout was taking back from earlier payouts: still to be taken from the next one.
    await db.run('UPDATE owner_deductions SET payout_id = NULL WHERE payout_id = ?', payoutId);
    await db.run('UPDATE trips SET payout_id = NULL WHERE payout_id = ?', payoutId);
    return getPayout(payoutId);
  });
}

/** An automatic payout failed (not one the office marked failed itself): fail it and tell the office. */
async function failAndAlert(payout, reason) {
  await failPayout(payout.id, reason);
  await notifyOffice({
    kind: 'payout.failed',
    title: `Payout to ${payout.owner_name} failed`,
    body: `${kesText(payout.amount)} did not reach the owner: ${reason}. The fares will be in the next payout, or send it yourself.`,
    target: `payout:${payout.id}`,
  });
}

/** M-Pesa's answer to a payout (Safaricom's callback, or IntaSend's status). Safe to receive more than once. */
export async function handleB2cResult(body) {
  const result = body?.Result;
  if (!result?.OriginatorConversationID) return;
  const payout = await db.get('SELECT * FROM payouts WHERE conversation_id = ?', result.OriginatorConversationID);
  if (!payout || payout.status !== 'processing') return;
  const ok = Number(result.ResultCode) === 0;
  try {
    if (ok) await completePayout(payout.id, String(result.TransactionID));
    else await failAndAlert(payout, String(result.ResultDesc ?? 'M-Pesa payment failed'));
  } catch (err) {
    // The same result arriving twice at the same moment: the other one already finished this payout.
    if (err.code === 'PAYOUT_FINISHED') return;
    throw err;
  }
  await audit(null, ok ? 'payout.confirmed' : 'payout.failed', 'payouts', payout.id, { amount: payout.amount, result: result.ResultDesc ?? null, reference: ok ? String(result.TransactionID) : null });
}

/** M-Pesa's queue timed out: the outcome is unknown, so leave it for the office to check. */
export async function handleB2cTimeout(body) {
  const id = body?.Result?.OriginatorConversationID ?? body?.OriginatorConversationID;
  if (!id) return;
  await db.run("UPDATE payouts SET result_desc = 'M-Pesa timed out. Check the M-Pesa statement.' WHERE conversation_id = ? AND status = 'processing'", id);
}

/** Asks the provider about payouts still processing (IntaSend reports this way; Daraja uses callbacks). */
export async function reconcileProcessingPayouts() {
  for (const payout of await db.all("SELECT * FROM payouts WHERE status = 'processing' AND provider_reference IS NOT NULL")) {
    try {
      const result = await mpesa.b2cStatus(payout.provider_reference);
      if (result) await handleB2cResult({ Result: { ...result, OriginatorConversationID: payout.conversation_id } });
    } catch (err) {
      console.error(`[payouts] status check for payout #${payout.id} failed:`, err.message);
    }
  }
}

/** Pays every owner who is owed something. Used by the daily run and by "Pay everyone now". */
export async function payEveryone(adminId = null) {
  const results = [];
  for (const owner of await owedByOwner()) {
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
  runDaily('daily_payouts', config.payoutDailyAt, dailyPayoutRun);
}

/** The daily run: pay every owner, record it, and tell the office what happened (and what's left for them to do). */
export async function dailyPayoutRun(today = nairobiToday()) {
  const paid = await payEveryone();
  await audit(null, 'payout.daily_run', 'payouts', null, { date: today, payouts: paid.map((p) => ({ id: p.id, owner: p.owner_name, amount: p.amount, status: p.status })) });
  console.log(`[payouts] daily payouts for ${today}: ${paid.length} owner(s)`);
  if (paid.length === 0) return paid;

  const count = (status) => paid.filter((p) => p.status === status);
  const total = (list) => kesText(list.reduce((sum, p) => sum + p.amount, 0));
  const [sent, manual, failed] = [count('completed').concat(count('processing')), count('manual'), count('failed')];
  const lines = [
    sent.length && `${sent.length} sent by M-Pesa (${total(sent)}).`,
    manual.length && `${manual.length} for you to send yourself (${total(manual)}): send the money, then record the M-Pesa code.`,
    failed.length && `${failed.length} failed (${total(failed)}): the fares will be in the next payout.`,
  ].filter(Boolean);
  await notifyOffice({
    kind: 'payout.daily',
    title: manual.length ? `${manual.length} owner payout${manual.length === 1 ? '' : 's'} waiting for you to send` : `Daily payouts: ${paid.length} owner${paid.length === 1 ? '' : 's'}`,
    body: lines.join(' '),
    target: 'payouts',
  });
  return paid;
}
