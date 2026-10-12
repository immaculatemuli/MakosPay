// Limits on how often something can be tried (wrong passwords, sign-ups, M-Pesa PIN prompts), so nobody can
// guess passwords or flood phones with PIN prompts. Counts are kept in memory: fine for one server, and a
// restart only resets the counters (it never lets money move).
import { HttpError } from './errors.js';

/**
 * A counter per key (e.g. phone number or IP address) over a sliding time window.
 * `hit(key)` records an attempt and throws 429 once `max` attempts were made within `windowMs`.
 */
export function limiter({ windowMs, max, message }) {
  const attempts = new Map(); // key -> timestamps (ms) within the window

  const recent = (key, now) => (attempts.get(key) ?? []).filter((t) => now - t < windowMs);

  // Forget old keys now and then, so memory doesn't grow.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, times] of attempts) {
      const kept = times.filter((t) => now - t < windowMs);
      if (kept.length) attempts.set(key, kept);
      else attempts.delete(key);
    }
  }, Math.min(windowMs, 10 * 60_000));
  sweep.unref();

  return {
    /** Throws if this key is already over the limit (without counting a new attempt). */
    check(key) {
      const now = Date.now();
      const times = recent(key, now);
      if (times.length >= max) {
        const retryAfter = Math.ceil((windowMs - (now - times[0])) / 1000);
        throw new HttpError(429, 'TOO_MANY_ATTEMPTS', message(Math.ceil(retryAfter / 60)), { retry_after_seconds: retryAfter });
      }
    },
    /** Counts one attempt. */
    record(key) {
      const now = Date.now();
      attempts.set(key, [...recent(key, now), now]);
    },
    /** check + record. */
    hit(key) {
      this.check(key);
      this.record(key);
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}

const minutes = (n) => `${n} minute${n === 1 ? '' : 's'}`;

// Wrong passwords: per phone number (protects one account) and per network address (one person guessing many).
export const wrongPasswordByPhone = limiter({
  windowMs: 15 * 60_000,
  max: 5,
  message: (m) => `Too many wrong passwords for this number. Try again in ${minutes(m)}, or ask the SACCO office to reset your password.`,
});
export const wrongPasswordByIp = limiter({ windowMs: 15 * 60_000, max: 30, message: (m) => `Too many wrong passwords. Try again in ${minutes(m)}.` });

export const signUpByIp = limiter({ windowMs: 60 * 60_000, max: 20, message: (m) => `Too many new accounts from this network. Try again in ${minutes(m)}.` });

// M-Pesa PIN prompts (top-ups and fares): each one rings a phone, so they are limited per passenger.
export const pinPromptsByUser = limiter({ windowMs: 10 * 60_000, max: 10, message: (m) => `Too many M-Pesa requests. Try again in ${minutes(m)}.` });

// The pay page for passengers without the app: anyone can open it, so prompts are limited per phone number
// rung and per network address asking.
export const noAppPromptsByPhone = limiter({ windowMs: 10 * 60_000, max: 5, message: (m) => `Too many M-Pesa requests for this number. Try again in ${minutes(m)}.` });
export const noAppPromptsByIp = limiter({ windowMs: 10 * 60_000, max: 20, message: (m) => `Too many M-Pesa requests. Try again in ${minutes(m)}.` });

// Asking for the current password (change password, delete account).
export const passwordChecksByUser = limiter({ windowMs: 60 * 60_000, max: 10, message: (m) => `Too many tries. Try again in ${minutes(m)}.` });

/** Express middleware: counts every request with this key (e.g. the signed-in user's id). */
export const limitBy = (lim, keyOf) => (req, _res, next) => {
  lim.hit(keyOf(req));
  next();
};
