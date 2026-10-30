// SMS through Africa's Talking (or, in development, written to the server's log). Texts are queued in sms_outbox
// inside the same transaction as the change they are about, and sent by flushSms() only once that is saved, so a
// change that is undone never sends a text. A sent text is removed from the outbox (it can hold a code).
import { config } from '../config.js';
import { db, NOW } from '../database.js';

const cfg = config.sms;
const MAX_ATTEMPTS = 3;
export const smsEnabled = () => cfg.provider !== 'off';

const toInternational = (phone) => (phone.startsWith('254') ? `+${phone}` : phone);
const masked = (phone) => `0${phone.slice(3, 6)}***${phone.slice(-3)}`;

/** Queues a text (call inside the transaction that makes the change). `kind` says what it is about, for the log. */
export async function queueSms(phone, kind, message) {
  if (!smsEnabled()) return;
  await db.insert('INSERT INTO sms_outbox (phone, kind, message) VALUES (?, ?, ?)', phone, kind, message);
  kick();
}

async function sendViaAfricasTalking(phone, message) {
  const base = cfg.baseUrlOverride ?? (cfg.username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com');
  const form = new URLSearchParams({ username: cfg.username, to: toInternational(phone), message });
  if (cfg.senderId && cfg.username !== 'sandbox') form.set('from', cfg.senderId);
  const res = await fetch(`${base}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: cfg.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  // 100 = processed, 101 = sent, 102 = queued: accepted by Africa's Talking.
  if (!res.ok || !recipient || ![100, 101, 102].includes(Number(recipient.statusCode))) {
    throw new Error(recipient?.status || data?.SMSMessageData?.Message || `HTTP ${res.status}`);
  }
  return recipient.messageId ?? null;
}

let flushing = false;

/** Sends every queued text (up to 3 tries each). Called on a timer and right after something is queued. */
export async function flushSms() {
  if (flushing) return;
  flushing = true;
  try {
    const queued = await db.all(`SELECT * FROM sms_outbox WHERE status = 'queued' AND attempts < ${MAX_ATTEMPTS} ORDER BY id LIMIT 50`);
    for (const sms of queued) {
      if (cfg.provider === 'log') {
        // Development only (refused in production): the text stays in the outbox so it can be read back.
        console.log(`[sms] to ${masked(sms.phone)} (${sms.kind}): ${sms.message}`);
        await db.run(`UPDATE sms_outbox SET status = 'logged', attempts = attempts + 1, sent_at = ${NOW} WHERE id = ?`, sms.id);
        continue;
      }
      try {
        const messageId = await sendViaAfricasTalking(sms.phone, sms.message);
        await db.run(`UPDATE sms_outbox SET status = 'sent', message = NULL, provider_message_id = ?, attempts = attempts + 1, sent_at = ${NOW} WHERE id = ?`, messageId, sms.id);
      } catch (err) {
        const last = sms.attempts + 1 >= MAX_ATTEMPTS;
        console.error(`[sms] to ${masked(sms.phone)} (${sms.kind}) failed: ${err.message}`);
        await db.run(
          `UPDATE sms_outbox SET attempts = attempts + 1, error = ?, status = ?, message = ${last ? 'NULL' : 'message'} WHERE id = ?`,
          String(err.message).slice(0, 300),
          last ? 'failed' : 'queued',
          sms.id,
        );
      }
    }
  } finally {
    flushing = false;
  }
}

// Send soon after queueing (the change has normally been saved by then; the timer catches anything later).
let kickTimer = null;
function kick() {
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    flushSms().catch((err) => console.error('[sms]', err.message));
  }, 300);
  kickTimer.unref?.();
}
