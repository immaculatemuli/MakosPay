// Signing up proves the phone number is the passenger's: a 6-digit code is sent to it by SMS first, and the
// account is only created with that code. Without it, anyone could sign up with someone else's number and see the
// fares and seat bookings that number paid for without the app (USSD, the pay page, the website).
// Only a hash of the code is kept. A code works once, for 10 minutes, with 5 tries; asking for a new one cancels the old.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db, NOW, tx } from '../database.js';
import { HttpError } from '../errors.js';
import { limiter } from '../ratelimit.js';
import { queueSms, smsEnabled } from './sms.js';
import { NO_APP_PASSWORD } from './users.js';

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const minutes = (n) => `${n} minute${n === 1 ? '' : 's'}`;

const codesByPhone = limiter({ windowMs: 60 * 60_000, max: 3, message: (m) => `Too many codes asked for this number. Try again in ${minutes(m)}.` });
const codesByIp = limiter({ windowMs: 60 * 60_000, max: 10, message: (m) => `Too many codes asked. Try again in ${minutes(m)}.` });

const hashOf = (phone, code) => createHash('sha256').update(`signup:${phone}:${code}:${config.jwtSecret}`).digest('hex');

/** Whether sign-up needs the SMS code. Only when the server can't send SMS (SMS_PROVIDER=off) does it not. */
export const signupCodeNeeded = () => smsEnabled();

/**
 * Refuses a number that already has an account. A passenger who has only paid without the app may sign up with
 * their number, but only once the SMS code proves it is theirs.
 */
export async function checkPhoneFree(phone, { proven }) {
  const existing = await db.get('SELECT role, password_hash, is_active FROM users WHERE phone = ?', phone);
  if (!existing) return;
  const paidWithoutApp = existing.role === 'passenger' && existing.password_hash === NO_APP_PASSWORD && existing.is_active;
  if (paidWithoutApp && proven) return;
  if (paidWithoutApp) throw new HttpError(409, 'PHONE_TAKEN', 'This number has already paid with FarePay. Ask the SACCO office to set a password for it.');
  throw new HttpError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
}

/** Sends a sign-up code to the number. */
export async function sendSignupCode(phone, ip) {
  if (!signupCodeNeeded()) return { code_needed: false };
  await checkPhoneFree(phone, { proven: true });
  codesByIp.hit(ip);
  codesByPhone.hit(phone);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await tx(async () => {
    await db.run(`UPDATE signup_codes SET used_at = ${NOW} WHERE phone = ? AND used_at IS NULL`, phone); // the old code stops working
    await db.insert(
      'INSERT INTO signup_codes (phone, code_hash, expires_at) VALUES (?, ?, ?)',
      phone,
      hashOf(phone, code),
      new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    );
    await queueSms(phone, 'signup_code', `Your FarePay sign-up code is ${code}. It works for ${CODE_MINUTES} minutes. Never share it: FarePay and ${config.saccoName} will never ask for it.`);
  });
  const message = `A 6-digit code has been sent to this number by SMS. It works for ${CODE_MINUTES} minutes.`;
  // SMS test mode (texts only go to the server's log, which the real server refuses to start with): the app shows
  // the code, since no SMS can reach the phone.
  if (config.sms.provider === 'log') return { code_needed: true, message, test_code: code };
  return { code_needed: true, message };
}

/** Checks the code from the SMS and uses it up. */
export async function useSignupCode(phone, code) {
  if (!code) throw new HttpError(400, 'CODE_NEEDED', 'Enter the 6-digit code sent to your phone by SMS. (If you don’t see where, update the FarePay app.)');
  const row = await db.get(
    'SELECT * FROM signup_codes WHERE phone = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1',
    phone,
    new Date().toISOString(),
  );
  if (!row) throw new HttpError(400, 'NO_CODE', 'This code has expired or was not sent. Ask for a new code.');
  if (row.attempts >= MAX_TRIES) throw new HttpError(429, 'TOO_MANY_TRIES', 'Too many wrong codes. Ask for a new code.');
  if (!timingSafeEqual(Buffer.from(hashOf(phone, code)), Buffer.from(row.code_hash))) {
    await db.run('UPDATE signup_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    const left = MAX_TRIES - row.attempts - 1;
    throw new HttpError(400, 'WRONG_CODE', left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right. Ask for a new code.');
  }
  const used = await db.run(`UPDATE signup_codes SET used_at = ${NOW} WHERE id = ? AND used_at IS NULL`, row.id);
  if (!used.changes) throw new HttpError(400, 'NO_CODE', 'This code has already been used. Ask for a new code.');
}
