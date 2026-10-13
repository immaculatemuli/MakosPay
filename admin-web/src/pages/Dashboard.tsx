import { useState } from 'react';
import { kes, plural, prettyDate } from '../format';
import type { Dashboard as DashboardData } from '../types';
import { Chips, Failed, Loading, PageHead, Stat, TestMoneyBanner } from '../ui';
import { useApi } from '../useApi';

const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
];

function change(now: number, before: number, days: number) {
  if (before === 0) return now === 0 ? 'Nothing collected in either period' : `Nothing collected in the ${days} days before`;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return `Same as the ${days} days before (${kes(before)})`;
  return `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on the ${days} days before (${kes(before)})`;
}

const hourRange = (h: number) => {
  const label = (x: number) => `${x % 12 === 0 ? 12 : x % 12}${x % 24 < 12 ? 'am' : 'pm'}`;
  return `${label(h)}–${label(h + 1)}`;
};

/** Collections over the last 7 or 30 days, from verified payments only (refunded fares left out). */
export function Dashboard() {
  const [days, setDays] = useState(7);
  const { data: d, error, loading, reload } = useApi<DashboardData>(`/admin/dashboard?days=${days}`);
  const [picked, setPicked] = useState<string | null>(null);

  const maxDay = Math.max(1, ...(d?.by_day.map((x) => x.total) ?? []));
  const maxRoute = Math.max(1, ...(d?.by_route.map((x) => x.total) ?? []));
  const maxVehicle = Math.max(1, ...(d?.by_vehicle.map((x) => x.total) ?? []));
  const day = d?.by_day.find((x) => x.date === picked) ?? d?.by_day.at(-1);
  const busiest = [...(d?.by_hour ?? [])].sort((a, b) => b.payments - a.payments || a.hour - b.hour).slice(0, 3);
  const idle = d?.by_vehicle.filter((v) => v.payments === 0) ?? [];

  return (
    <>
      <PageHead title="Dashboard" subtitle={d && `${prettyDate(d.from_date)} – ${prettyDate(d.to_date)}`}>
        <Chips options={PERIODS} value={days} onChange={(v) => { setDays(v); setPicked(null); }} />
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !d && <Loading />}
      {d && (
        <>
          <TestMoneyBanner realMoney={d.real_money} />
          <div className="stats">
            <Stat label="Collected" value={kes(d.totals.collected)} note={change(d.totals.collected, d.previous.collected, d.days)} />
            <Stat label="Fare payments" value={d.totals.payments} />
            <Stat label="Passengers who paid" value={d.totals.passengers} />
            <Stat label="Average fare" value={d.totals.payments ? kes(Math.round(d.totals.collected / d.totals.payments)) : '—'} />
            <Stat label="Wallet top-ups" value={kes(d.topups.amount)} note={plural(d.topups.count, 'top-up')} />
          </div>
          {d.refunds.count > 0 && <p className="muted">{plural(d.refunds.count, 'fare')} refunded ({kes(d.refunds.amount)}), not counted above.</p>}

          <h2>Each day</h2>
          <div className="card">
            {day && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 22 }}>{kes(day.total)}</strong>{' '}
                <span className="muted">
                  {prettyDate(day.date, true)} · {plural(day.payments, 'payment')}
                </span>
              </div>
            )}
            <div className="bars">
              {d.by_day.map((x) => (
                <button key={x.date} className={x.date === day?.date ? 'on' : ''} onClick={() => setPicked(x.date)} title={`${prettyDate(x.date)}: ${kes(x.total)}`} aria-label={`${prettyDate(x.date)}: ${kes(x.total)}`}>
                  <span className={x.total ? '' : 'empty'} style={{ height: `${Math.max(2, (x.total / maxDay) * 100)}%` }} />
                </button>
              ))}
            </div>
            <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span>{prettyDate(d.from_date)}</span>
              <span>{prettyDate(d.to_date)}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <section>
              <h2>By route</h2>
              <div className="card">
                {d.by_route.length === 0 && <span className="muted">No payments in this period.</span>}
                {d.by_route.map((r) => (
                  <div key={r.id} style={{ padding: '8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        <strong>{r.name}</strong> <span className="muted">{plural(r.payments, 'payment')}</span>
                      </span>
                      <strong>{kes(r.total)}</strong>
                    </div>
                    <div className="share"><div style={{ width: `${(r.total / maxRoute) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2>By vehicle</h2>
              <div className="card">
                {d.by_vehicle.length === 0 && <span className="muted">No vehicles yet.</span>}
                {d.by_vehicle.map((v) => (
                  <div key={v.id} style={{ padding: '8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        <strong>{v.plate}</strong> <span className="muted">{v.owner_name} · {plural(v.payments, 'payment')}</span>
                      </span>
                      <strong>{kes(v.total)}</strong>
                    </div>
                    <div className="share"><div style={{ width: `${(v.total / maxVehicle) * 100}%` }} /></div>
                  </div>
                ))}
                {idle.length > 0 && (
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {idle.map((v) => v.plate).join(', ')}: no FarePay payments in this period. Check the QR sticker and the route.
                  </p>
                )}
              </div>
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <section>
              <h2>Most popular drop-offs</h2>
              <div className="card">
                {d.top_stops.length === 0 && <span className="muted">No payments in this period.</span>}
                {d.top_stops.map((s) => (
                  <div className="kv" key={`${s.route_name}-${s.stop_name}`}>
                    <span>{s.stop_name} ({s.route_name})</span>
                    <span>{plural(s.payments, 'trip')} · {kes(s.total)}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2>Busiest times</h2>
              <div className="card">
                {busiest.length === 0 && <span className="muted">No payments in this period.</span>}
                {busiest.map((h) => (
                  <div className="kv" key={h.hour}>
                    <span>{hourRange(h.hour)}</span>
                    <span>{plural(h.payments, 'payment')}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
