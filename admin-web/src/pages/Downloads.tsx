import { useState } from 'react';
import { nairobiToday, prettyDate } from '../format';
import { Chips, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom';
const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Choose dates' },
];

const shift = (ymd: string, days: number) => new Date(Date.parse(ymd) + days * 86_400_000).toISOString().slice(0, 10);

function datesOf(key: PeriodKey, custom: { from: string; to: string }) {
  const today = nairobiToday();
  if (key === 'today') return { from: today, to: today };
  if (key === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) };
  if (key === 'week') return { from: shift(today, -6), to: today };
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === 'last_month') {
    const firstThis = `${today.slice(0, 7)}-01`;
    const lastPrev = shift(firstThis, -1);
    return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
  }
  return custom;
}

/** Reports for the accountant: each downloads as a file that opens in Excel. */
export function Downloads() {
  const reports = useApi<{ kind: string; title: string }[]>('/admin/exports');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState({ from: shift(nairobiToday(), -30), to: nairobiToday() });
  const { from, to } = datesOf(period, custom);
  const ok = from <= to;

  return (
    <>
      <PageHead title="Reports & downloads" subtitle="Takings and payouts for the accountant. Each one opens in Excel." />
      <div className="card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Chips options={PERIODS} value={period} onChange={setPeriod} />
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label>
              From
              <input type="date" value={custom.from} max={nairobiToday()} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label>
              To
              <input type="date" value={custom.to} max={nairobiToday()} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </div>
        )}
        <p className="muted" style={{ margin: 0 }}>
          {ok ? (from === to ? prettyDate(from, true) : `${prettyDate(from)} – ${prettyDate(to)}`) : 'The end date is before the start date.'}
        </p>
      </div>
      {reports.error && <Failed message={reports.error} onRetry={reports.reload} />}
      {reports.loading && !reports.data && <Loading />}
      <div className="stats">
        {reports.data?.map((r) => (
          <a
            key={r.kind}
            className={`card download${ok ? '' : ' disabled'}`}
            href={ok ? `/admin/exports/${r.kind}?from=${from}&to=${to}` : undefined}
            download
          >
            <strong>{r.title}</strong>
            <span className="muted">Download for Excel</span>
          </a>
        ))}
      </div>
    </>
  );
}
