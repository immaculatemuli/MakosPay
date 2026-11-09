import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Kenya is UTC+3 all year (no DST).
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

// No 0/O/1/I so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export const newQrToken = () => randomBytes(16).toString('base64url');

/** Normalises Kenyan mobile numbers to 2547XXXXXXXX / 2541XXXXXXXX, or returns null. */
export function normalizePhone(input) {
  const digits = String(input ?? '').replace(/[\s\-()+]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^[17]\d{8}$/.test(digits)) return '254' + digits;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}

/** 254712345678 -> 0712***678 (what conductors see). */
export const maskPhone = (phone) => (phone ? `0${phone.slice(3, 6)}***${phone.slice(-3)}` : null);

export const nairobiToday = () => new Date(Date.now() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);

/** [startIso, endIso) in UTC for a YYYY-MM-DD calendar day in Nairobi. */
export function nairobiDayRange(date) {
  const start = new Date(`${date}T00:00:00.000+03:00`);
  if (Number.isNaN(start.getTime())) return null;
  return [start.toISOString(), new Date(start.getTime() + 86_400_000).toISOString()];
}

/** YYYYMMDDHHmmss in Nairobi time, as Daraja expects. */
export const mpesaTimestamp = (date = new Date()) =>
  new Date(date.getTime() + NAIROBI_OFFSET_MS).toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** Accepts the raw text scanned from a QR code (full URL or bare token) and returns the vehicle token. */
export function parseQr(raw) {
  const text = String(raw ?? '').trim();
  try {
    const token = new URL(text).searchParams.get('v');
    if (token) return token;
  } catch {
    // not a URL: treat as bare token
  }
  return text;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when an app version ("1.0.0") is older than another ("1.1.0"), compared part by part. */
export function appTooOld(version, minimum) {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d < 0;
  }
  return false;
}
