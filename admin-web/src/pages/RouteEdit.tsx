import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { dateTime, kes, nairobiToday, prettyDate } from '../format';
import type { FareChange, Route, Stop } from '../types';
import { Badge, Banner, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

type StopDraft = { id?: number; name: string; cash_fare: string; app_fare: string };
const toDraft = (s: Stop): StopDraft => ({ id: s.id, name: s.name, cash_fare: String(s.cash_fare), app_fare: String(s.app_fare) });
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

/** Add a route, or change one: its name, start, drop-off stops and their fares. Fare history and scheduled changes below. */
export function RouteEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const route = useApi<Route>(isNew ? null : `/admin/routes/${id}`);
  const history = useApi<FareChange[]>(isNew ? null : `/admin/routes/${id}/fare-changes`);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [stops, setStops] = useState<StopDraft[]>([{ name: '', cash_fare: '', app_fare: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Stop | null>(null);
  const [cancel, setCancel] = useState<FareChange | null>(null);
  const [onOff, setOnOff] = useState(false);

  useEffect(() => {
    if (route.data) {
      setName(route.data.name);
      setOrigin(route.data.origin);
      setStops(route.data.stops.map(toDraft));
    }
  }, [route.data]);

  if (!isNew && route.loading && !route.data) return <Loading />;
  if (!isNew && !route.data) return <Failed message={route.error ?? 'Route not found'} onRetry={route.reload} />;
  const r = route.data;

  const problems: string[] = [];
  if (name.trim().length < 2) problems.push('Give the route a name.');
  if (origin.trim().length < 2) problems.push('Say where it starts.');
  if (stops.length === 0) problems.push('Add at least one drop-off stop.');
  stops.forEach((s, i) => {
    const [cash, app] = [whole(s.cash_fare), whole(s.app_fare)];
    if (s.name.trim().length < 2) problems.push(`Stop ${i + 1}: give it a name.`);
    if (!(cash > 0) || !(app > 0)) problems.push(`Stop ${i + 1}: fares must be whole shillings above 0.`);
    else if (app > cash) problems.push(`Stop ${i + 1}: the member fare can't be more than the cash fare.`);
  });
  if (new Set(stops.map((s) => s.name.trim().toLowerCase())).size !== stops.length) problems.push('Each stop needs a different name.');

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    const body = {
      name: name.trim(),
      origin: origin.trim(),
      stops: stops.map((s) => ({ ...(s.id && { id: s.id }), name: s.name.trim(), cash_fare: whole(s.cash_fare), app_fare: whole(s.app_fare) })),
    };
    try {
      if (isNew) {
        const created = await api<Route>('/admin/routes', { method: 'POST', body });
        navigate(`/routes/${created.id}`, { replace: true });
      } else {
        await api(`/admin/routes/${id}`, { method: 'PATCH', body });
        await Promise.all([route.reload(), history.reload()]);
        setSaved('Saved. Changed fares apply from now, and are in the fare history below.');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const setStop = (i: number, change: Partial<StopDraft>) => setStops((all) => all.map((s, j) => (j === i ? { ...s, ...change } : s)));
  const move = (i: number, by: number) =>
    setStops((all) => {
      const next = [...all];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  return (
    <>
      <p>
        <Link to="/routes">← Routes & fares</Link>
      </p>
      <PageHead title={isNew ? 'New route' : (r?.name ?? '')} subtitle={!isNew && r && !r.is_active ? 'Switched off: passengers can’t choose it.' : undefined}>
        {!isNew && r && (
          <button className="secondary" onClick={() => setOnOff(true)}>
            {r.is_active ? 'Switch route off' : 'Switch route on'}
          </button>
        )}
      </PageHead>

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label>
            Route name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thika Road" />
          </label>
          <label>
            Starts at
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="e.g. Town (Odeon)" />
          </label>
        </div>
        <h2 style={{ marginTop: 6 }}>Drop-off stops, in order</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stop</th>
                <th>Cash fare (KES)</th>
                <th>FarePay member fare (KES)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => (
                <tr key={s.id ?? `new-${i}`}>
                  <td>
                    <input value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} placeholder="e.g. Juja" aria-label={`Stop ${i + 1} name`} />
                  </td>
                  <td>
                    <input value={s.cash_fare} onChange={(e) => setStop(i, { cash_fare: e.target.value })} inputMode="numeric" style={{ width: 110 }} aria-label={`Stop ${i + 1} cash fare`} />
                  </td>
                  <td>
                    <input value={s.app_fare} onChange={(e) => setStop(i, { app_fare: e.target.value })} inputMode="numeric" style={{ width: 110 }} aria-label={`Stop ${i + 1} member fare`} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>{' '}
                    <button className="secondary" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>{' '}
                    {s.id && r?.stops.find((x) => x.id === s.id) && (
                      <button className="secondary" onClick={() => setSchedule(r.stops.find((x) => x.id === s.id)!)}>
                        Fare from a date…
                      </button>
                    )}{' '}
                    <button className="secondary" onClick={() => setStops((all) => all.filter((_, j) => j !== i))} aria-label="Remove stop">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <button className="secondary" onClick={() => setStops((all) => [...all, { name: '', cash_fare: '', app_fare: '' }])}>
            + Add a stop
          </button>
        </p>
        <p className="muted">
          Fares changed here apply at once (past payments keep the fare they were paid at). A removed stop is switched off, not deleted, so its past payments stay.
        </p>
        {problems.length > 0 && <Banner>{problems[0]}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        {saved && <Banner tone="success">{saved}</Banner>}
        <button onClick={() => void save()} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : isNew ? 'Add route' : 'Save changes'}
        </button>
      </div>

      {!isNew && (
        <>
          <h2>Fare history</h2>
          {history.error && <Failed message={history.error} onRetry={history.reload} />}
          {history.data?.length === 0 && <p className="muted">No fare changes yet.</p>}
          {!!history.data?.length && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Stop</th>
                    <th>Member fare</th>
                    <th>Cash fare</th>
                    <th>From</th>
                    <th>By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((f) => (
                    <tr key={f.id}>
                      <td>{f.stop_name}</td>
                      <td>
                        {kes(f.old_app_fare)} → {kes(f.new_app_fare)}
                      </td>
                      <td>
                        {kes(f.old_cash_fare)} → {kes(f.new_cash_fare)}
                      </td>
                      <td>{dateTime(f.effective_from)}</td>
                      <td>
                        {f.changed_by_name}
                        {f.reason && <div className="muted">{f.reason}</div>}
                      </td>
                      <td>
                        {f.cancelled_at ? (
                          <Badge>Cancelled</Badge>
                        ) : f.applied_at ? (
                          <Badge tone="success">In effect</Badge>
                        ) : (
                          <>
                            <Badge tone="warning">Waiting for its date</Badge>{' '}
                            <button className="link" onClick={() => setCancel(f)}>
                              Cancel
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {schedule && <ScheduleFare stop={schedule} onClose={() => setSchedule(null)} onDone={() => Promise.all([route.reload(), history.reload()]).then(() => setSchedule(null))} />}
      {cancel && (
        <Dialog
          title={`Cancel the new fare for ${cancel.stop_name}?`}
          actionLabel="Cancel this change"
          danger
          action={async () => {
            await api(`/admin/fare-changes/${cancel.id}/cancel`, { method: 'POST' });
            setCancel(null);
            await history.reload();
          }}
          onClose={() => setCancel(null)}
        >
          <p className="muted">
            It was to start {dateTime(cancel.effective_from)}. The fare stays {kes(cancel.old_app_fare)} (member) / {kes(cancel.old_cash_fare)} (cash).
          </p>
        </Dialog>
      )}
      {onOff && r && (
        <Dialog
          title={r.is_active ? `Switch ${r.name} off?` : `Switch ${r.name} back on?`}
          actionLabel={r.is_active ? 'Switch off' : 'Switch on'}
          danger={Boolean(r.is_active)}
          action={async () => {
            await api(`/admin/routes/${r.id}`, { method: 'PATCH', body: { is_active: !r.is_active } });
            setOnOff(false);
            await route.reload();
          }}
          onClose={() => setOnOff(false)}
        >
          <p className="muted">{r.is_active ? 'Passengers will no longer be able to choose it, and vehicles on it can’t take FarePay payments.' : 'Passengers can choose it again.'}</p>
        </Dialog>
      )}
    </>
  );
}

/** A new fare for one stop from a date (Kenyan time, from midnight that day). Today applies at once. */
function ScheduleFare({ stop, onClose, onDone }: { stop: Stop; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [cash, setCash] = useState(String(stop.cash_fare));
  const [app, setApp] = useState(String(stop.app_fare));
  const [date, setDate] = useState(nairobiToday());
  const [reason, setReason] = useState('');
  const [c, a] = [whole(cash), whole(app)];
  const ok = c > 0 && a > 0 && a <= c && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Dialog
      title={`New fare for ${stop.name}`}
      actionLabel={date <= nairobiToday() ? 'Change fare now' : `Change from ${prettyDate(date)}`}
      disabled={!ok}
      action={async () => {
        await api(`/admin/stops/${stop.id}/fare-change`, { method: 'POST', body: { cash_fare: c, app_fare: a, effective_date: date, ...(reason.trim() && { reason: reason.trim() }) } });
        await onDone();
      }}
      onClose={onClose}
    >
      <p className="muted">
        Now {kes(stop.app_fare)} member / {kes(stop.cash_fare)} cash. Passengers who use this route are told about the change.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label>
          Cash fare (KES)
          <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          Member fare (KES)
          <input value={app} onChange={(e) => setApp(e.target.value)} inputMode="numeric" />
        </label>
      </div>
      <label>
        From (Kenyan time, start of that day)
        <input type="date" value={date} min={nairobiToday()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Reason (optional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fuel price change" />
      </label>
      {a > c && <Banner>The member fare can't be more than the cash fare.</Banner>}
    </Dialog>
  );
}
