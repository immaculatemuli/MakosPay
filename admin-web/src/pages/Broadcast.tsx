import { useState } from 'react';
import { api, errorText } from '../api';
import type { Route } from '../types';
import { Banner, PageHead } from '../ui';
import { useApi } from '../useApi';

type Audience = 'drivers' | 'crew' | 'marshals';
const WHO: { value: Audience; label: string }[] = [
  { value: 'drivers', label: 'Drivers' },
  { value: 'crew', label: 'Drivers and conductors' },
  { value: 'marshals', label: 'Stage marshals' },
];

/** One message to many crew at once: under their bell and as a push notification, optionally also by SMS. */
export function Broadcast() {
  const routes = useApi<Route[]>('/admin/routes');
  const [audience, setAudience] = useState<Audience>('drivers');
  const [routeId, setRouteId] = useState('');
  const [message, setMessage] = useState('');
  const [sms, setSms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const onRoute = audience !== 'marshals' && routeId;
  const count = useApi<{ count: number }>(`/admin/broadcast/count?audience=${audience}${onRoute ? `&route_id=${routeId}` : ''}`);

  const send = async () => {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const r = await api<{ sent_to: number; by_sms: boolean }>('/admin/broadcast', {
        method: 'POST',
        body: { audience, route_id: onRoute ? Number(routeId) : null, message: message.trim(), sms },
      });
      setSent(`Sent to ${r.sent_to} ${r.sent_to === 1 ? 'person' : 'people'}${r.by_sms ? ', also by SMS' : ''}.`);
      setMessage('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Message crew" subtitle="One message to many at once, e.g. a road closure. It arrives under their bell and as a notification." />
      <div className="card" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label>
          Send to
          <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {WHO.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        {audience !== 'marshals' && (
          <label>
            On route
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">All routes</option>
              {routes.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Message ({message.trim().length}/300)
          <textarea rows={4} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Thika Road closed at Juja, use the bypass." />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
          <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
          Also send by SMS (costs one text each)
        </label>
        {error && <Banner tone="danger">{error}</Banner>}
        {sent && <Banner tone="success">{sent}</Banner>}
        <button onClick={() => void send()} disabled={busy || message.trim().length < 3 || !count.data?.count}>
          {count.data ? `Send to ${count.data.count} ${count.data.count === 1 ? 'person' : 'people'}` : 'Send'}
        </button>
      </div>
    </>
  );
}
