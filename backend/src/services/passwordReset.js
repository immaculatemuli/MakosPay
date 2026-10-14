// "Forgot password": a 6-digit code is sent by SMS to the account's phone number; with it, a new password can be
// set. Only a hash of the code is kept. A code works once, for 10 minutes, with 5 tries; asking for a new one
// cancels the old. The answer to "send me a code" is the same whether or not the number has an account, so nobody
// can find out who uses FarePay.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError } from '../errors.js';
import { limiter } from '../ratelimit.js';
import { audit } from './audit.js';
import { queueSms, smsEnabled } from './sms.js';
import { setPassword } from './users.js';

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const minutes = (n) => `${n} minute${n === 1 ? '' : 's'}`;

const requestsByPhone = limiter({ windowMs: 60 * 60_000, max: 3, message: (m) => `Too many codes asked for this number. Try again in ${minutes(m)}.` });
const requestsByIp = limiter({ windowMs: 60 * 60_000, max: 10, message: (m) => `Too many codes asked. Try again in ${minutes(m)}.` });

const hashOf = (userId, code) => createHash('sha256').update(`${userId}:${code}:${config.jwtSecret}`).digest('hex');

export const SENT_MESSAGE = 'If this number has a FarePay account, a 6-digit code has been sent to it by SMS. It works for 10 minutes.';

/** Sends a reset code to the number's account, if there is one. */
export async function requestReset(phone, ip) {
  if (!smsEnabled()) throw new HttpError(503, 'SMS_OFF', 'Resetting a password by SMS is not available yet. Ask the SACCO office to set a new password for you.');
  requestsByIp.hit(ip);
  requestsByPhone.hit(phone);
  const user = await db.get('SELECT id FROM users WHERE phone = ? AND is_active = TRUE', phone);
  if (!user) return { message: SENT_MESSAGE };
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await tx(async () => {
    await db.run(`UPDATE password_resets SET used_at = ${NOW} WHERE user_id = ? AND used_at IS NULL`, user.id); // the old code stops working
    await db.insert(
      'INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)',
      user.id,
      hashOf(user.id, code),
      new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    );
    await queueSms(phone, 'password_reset', `Your FarePay code is ${code}. It works for ${CODE_MINUTES} minutes. Never share it: FarePay and ${config.saccoName} will never ask for it.`);
  });
  return { message: SENT_MESSAGE };
}

/** Sets a new password with the code from the SMS. Every phone signed in with the old password is signed out. */
export async function confirmReset(phone, code, newPassword) {
  const user = await db.get('SELECT id FROM users WHERE phone = ? AND is_active = TRUE', phone);
  const reset =
    user &&
    (await db.get('SELECT * FROM password_resets WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1', user.id, new Date().toISOString()));
  if (!reset) throw new HttpError(400, 'NO_CODE', 'This code has expired or was not sent. Ask for a new code.');
  if (reset.attempts >= MAX_TRIES) throw new HttpError(429, 'TOO_MANY_TRIES', 'Too many wrong codes. Ask for a new code.');
  const given = Buffer.from(hashOf(user.id, String(code).trim()));
  if (!timingSafeEqual(given, Buffer.from(reset.code_hash))) {
    await db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', reset.id);
    const left = MAX_TRIES - reset.attempts - 1;
    throw new HttpError(400, 'WRONG_CODE', left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right. Ask for a new code.');
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await tx(async () => {
    const used = await db.run(`UPDATE password_resets SET used_at = ${NOW} WHERE id = ? AND used_at IS NULL`, reset.id);
    if (!used.changes) throw new HttpError(400, 'NO_CODE', 'This code has already been used. Ask for a new code.');
    await setPassword(user.id, hash);
    const who = await db.get('SELECT id, role FROM users WHERE id = ?', user.id);
    await audit(who, 'account.password_reset_by_sms', 'users', user.id);
  });
  return { ok: true };
}
