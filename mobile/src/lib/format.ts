import { currentLanguage } from './i18n';

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SW = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
export const monthName = (index: number) => (currentLanguage() === 'sw' ? MONTHS_SW : MONTHS_EN)[index];
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

const withCommas = (n: number) => Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const kes = (n: number) => `${n < 0 ? '-' : ''}KES ${withCommas(n)}`;
export const signedKes = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}KES ${withCommas(n)}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** Shows server timestamps (UTC) in Kenyan time regardless of the phone's time zone. */
function nairobiParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + NAIROBI_OFFSET_MS);
  return { day: d.getUTCDate(), month: monthName(d.getUTCMonth()), year: d.getUTCFullYear(), h: pad(d.getUTCHours()), m: pad(d.getUTCMinutes()) };
}

export function dateTime(iso: string) {
  const p = nairobiParts(iso);
  return `${p.day} ${p.month} ${p.year}, ${p.h}:${p.m}`;
}

export function time(iso: string) {
  const p = nairobiParts(iso);
  return `${p.h}:${p.m}`;
}

/** YYYY-MM-DD in Nairobi, shifted by a number of days. */
export function nairobiDate(offsetDays = 0) {
  return new Date(Date.now() + NAIROBI_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function prettyDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${monthName(m - 1)} ${y}`;
}

export const displayPhone = (phone: string | null) => (phone?.startsWith('254') ? `0${phone.slice(3)}` : (phone ?? ''));
