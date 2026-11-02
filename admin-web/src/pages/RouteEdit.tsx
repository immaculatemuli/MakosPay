import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { dateTime, kes, nairobiToday, prettyDate } from '../format';
import type { FareChange, Route } from '../types';
import { Badge, Banner, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

// A route has one fixed fare: every passenger pays it, wherever they get off. Stops are just names.
type StopDraft = { id?: number; name: string };
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

/** Add a route, or change one: its name, start, its one fare and its drop-off stops. Fare history and scheduled changes below. */
export function RouteEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const route = useApi<Route>(isNew ? null : `/admin/routes/${id}`);
  const history = useApi<FareChange[]>(isNew ? null : `/admin/routes/${id}/fare-changes`);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [fare, setFare] = useState('');
  const [stops, setStops] = useState<StopDraft[]>([{ name: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [cancel, setCancel] = useState<FareChange | null>(null);
  const [onOff, setOnOff] = useState(false);

  useEffect(() => {
    if (route.data) {
      setName(route.data.name);
      setOrigin(route.data.origin);
      setFare(route.data.fare ? String(route.data.fare) : '');
      setStops(route.data.stops.map((s) => ({ id: s.id, name: s.name })));
    }
  }, [route.data]);

  if (!isNew && route.loading && !route.data) return <Loading />;
  if (!isNew && !route.data) return <Failed message={route.error ?? 'Route not found'} onRetry={route.reload} />;
  const r = route.data;

  const problems: string[] = [];
  if (name.trim().length < 2) problems.push('Give the route a name.');
  if (origin.trim().length < 2) problems.push('Say where it starts.');
  if (!(whole(fare) > 0)) problems.push('The fare must be whole shillings above 0.');
  if (stops.length === 0) problems.push('Add at least one drop-off stop.');
  stops.forEach((s, i) => {
    if (s.name.trim().length < 2) problems.push(`Stop ${i + 1}: give it a name.`);
  });
  if (new Set(stops.map((s) => s.name.trim().toLowerCase())).size !== stops.length) problems.push('Each stop needs a different name.');

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    const body = {
      name: name.trim(),
      origin: origin.trim(),
      fare: whole(fare),
      stops: stops.map((s) => ({ ...(s.id && { id: s.id }), name: s.name.trim() })),
    };
    try {
      if (isNew) {
        const created = await api<Route>('/admin/routes', { method: 'POST', body });
        navigate(`/routes/${created.id}`, { replace: true });
      } else {
        await api(`/admin/routes/${id}`, { method: 'PATCH', body });
        await Promise.all([route.reload(), history.reload()]);
        setSaved('Saved. A changed fare applies from now, and is in the fare history below.');
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
          <label>
            Fare (KES)
            <input value={fare} onChange={(e) => setFare(e.target.value)} inputMode="numeric" placeholder="e.g. 200" />
          </label>
        </div>
        <p className="muted">
          One fixed fare for the whole route: passengers pay it wherever they get off.{' '}
          {!isNew && r?.fare && (
            <button className="link" onClick={() => setSchedule(true)}>
              Change the fare from a date…
            </button>
          )}
        </p>
        <h2 style={{ marginTop: 6 }}>Drop-off stops, in order</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stop</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => (
                <tr key={s.id ?? `new-${i}`}>
                  <td>
                    <input value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} placeholder="e.g. Juja" aria-label={`Stop ${i + 1} name`} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>{' '}
                    <button className="secondary" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>{' '}
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
          <button className="secondary" onClick={() => setStops((all) => [...all, { name: '' }])}>
            + Add a stop
          </button>
        </p>
        <p className="muted">
          A fare changed here applies at once (past payments keep the fare they were paid at). A removed stop is switched off, not deleted, so its past payments stay.
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
                    <th>Fare</th>
                    <th>From</th>
                    <th>By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {kes(f.old_app_fare)} → {kes(f.new_app_fare)}
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

      {schedule && r && <ScheduleFare route={r} onClose={() => setSchedule(false)} onDone={() => Promise.all([route.reload(), history.reload()]).then(() => setSchedule(false))} />}
      {cancel && (
        <Dialog
          title={`Cancel the new fare for ${r?.name}?`}
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
            It was to start {dateTime(cancel.effective_from)}. The fare stays {kes(cancel.old_app_fare)}.
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

/** A new fare for the whole route from a date (Kenyan time, from midnight that day). Today applies at once. */
function ScheduleFare({ route, onClose, onDone }: { route: Route; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [fareText, setFareText] = useState(String(route.fare));
  const [date, setDate] = useState(nairobiToday());
  const [reason, setReason] = useState('');
  const fare = whole(fareText);
  const ok = fare > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Dialog
      title={`New fare for ${route.name}`}
      actionLabel={date <= nairobiToday() ? 'Change fare now' : `Change from ${prettyDate(date)}`}
      disabled={!ok}
      action={async () => {
        await api(`/admin/routes/${route.id}/fare-change`, { method: 'POST', body: { fare, effective_date: date, ...(reason.trim() && { reason: reason.trim() }) } });
        await onDone();
      }}
      onClose={onClose}
    >
      <p className="muted">
        Now {kes(route.fare ?? 0)} to every stop. Passengers who use this route are told about the change.
      </p>
      <label>
        New fare (KES)
        <input value={fareText} onChange={(e) => setFareText(e.target.value)} inputMode="numeric" />
      </label>
      <label>
        From (Kenyan time, start of that day)
        <input type="date" value={date} min={nairobiToday()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        Reason (optional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fuel price change" />
      </label>
    </Dialog>
  );
}
