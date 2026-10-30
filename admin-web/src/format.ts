// Money and times as the office expects them: whole Kenyan shillings, Kenyan time whatever the computer's zone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NAIROBI_MS = 3 * 60 * 60 * 1000;

export const kes = (n: number) => `KES ${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-KE')}`;

const nairobi = (iso: string) => new Date(new Date(iso).getTime() + NAIROBI_MS);
const pad = (n: number) => String(n).padStart(2, '0');

export function dateTime(iso: string) {
  const d = nairobi(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const time = (iso: string) => {
  const d = nairobi(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** "2026-10-11" -> "Sun 11 Oct 2026" */
export function prettyDate(ymd: string, withWeekday = false) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${withWeekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Today's date in Kenya, YYYY-MM-DD. */
export const nairobiToday = () => new Date(Date.now() + NAIROBI_MS).toISOString().slice(0, 10);

export const displayPhone = (phone: string | null) => (phone?.startsWith('254') ? `0${phone.slice(3)}` : (phone ?? ''));

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
