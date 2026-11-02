import { nairobiDate } from './format';

/** Report periods (Kenyan dates, from–to inclusive). */
export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'last_month';

export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
];

export function periodDates(key: PeriodKey): { from: string; to: string } {
  const today = nairobiDate(0);
  if (key === 'today') return { from: today, to: today };
  if (key === 'yesterday') return { from: nairobiDate(-1), to: nairobiDate(-1) };
  if (key === 'week') return { from: nairobiDate(-6), to: today };
  const [y, m] = today.split('-').map(Number);
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  const first = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
