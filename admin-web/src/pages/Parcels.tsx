import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { dateTime, displayPhone, kes, plural } from '../format';
import type { Parcel, ParcelStatus, Route } from '../types';
import { Badge, Banner, Chips, Dialog, Failed, Loading, PageHead, Stat } from '../ui';
import { useApi } from '../useApi';

export const PARCEL_STATUS: Record<ParcelStatus, { label: string; tone?: 'success' | 'danger' | 'warning' }> = {
  awaiting_payment: { label: 'Waiting for payment', tone: 'warning' },
  received: { label: 'At the office', tone: undefined },
  on_the_way: { label: 'On the way', tone: undefined },
  arrived: { label: 'Arrived', tone: 'success' },
  collected: { label: 'Collected', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

const PAID_BY = { mpesa_prompt: 'M-Pesa (PIN prompt)', mpesa_code: 'M-Pesa', cash: 'Cash' } as const;

/** Every parcel, newest first: search, filter by where it is, and the last 30 days' parcel income. */
export function Parcels() {
  const [status, setStatus] = useState<ParcelStatus | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const params = new URLSearchParams({ ...(status && { status }), ...(query && { search: query }) }).toString();
  const { data, error, loading, reload } = useApi<{ parcels: Parcel[]; last_30_days: { paid: number; fees: number } }>(`/admin/parcels${params ? `?${params}` : ''}`);

  return (
    <>
      <PageHead title="Parcels" subtitle="Parcels sent through the office. Fees are SACCO income, separate from fares and owner payouts.">
        <Link className="button" to="/parcels/new">
          Record a parcel
        </Link>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {data && (
        <div className="stats">
          <Stat label="Parcel fees, last 30 days" value={kes(data.last_30_days.fees)} note={plural(data.last_30_days.paid, 'paid parcel')} />
        </div>
      )}
      <form
        className="card"
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <label style={{ margin: 0, flex: 1, minWidth: 220 }}>
          Find a parcel
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tracking code, name or phone number" />
        </label>
        <button type="submit">Search</button>
      </form>
      <Chips
        options={[{ value: '' as ParcelStatus | '', label: 'All' }, ...Object.entries(PARCEL_STATUS).map(([value, s]) => ({ value: value as ParcelStatus, label: s.label }))]}
        value={status}
        onChange={setStatus}
      />
      {loading && !data && <Loading />}
      {data && data.parcels.length === 0 && <p className="muted">No parcels{status || query ? ' match' : ' yet'}.</p>}
      {data && data.parcels.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tracking code</th>
                <th>Recorded</th>
                <th>From → to</th>
                <th>Sender</th>
                <th>Receiver</th>
                <th className="num">Fee</th>
                <th>Where it is</th>
              </tr>
            </thead>
            <tbody>
              {data.parcels.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/parcels/${p.id}`}>{p.tracking_code}</Link>
                  </td>
                  <td>{dateTime(p.created_at)}</td>
                  <td>
                    {p.origin} → {p.stop_name}
                  </td>
                  <td>{p.sender_name}</td>
                  <td>{p.receiver_name}</td>
                  <td className="num">{kes(p.fee)}</td>
                  <td>
                    <Badge tone={PARCEL_STATUS[p.status].tone}>{PARCEL_STATUS[p.status].label}</Badge>
                    {p.plate && ['on_the_way', 'arrived'].includes(p.status) && <span className="muted"> {p.plate}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type Pay = 'prompt' | 'cash' | 'mpesa_code';

/** Record a parcel at the counter and take the fee. */
export function ParcelNew() {
  const navigate = useNavigate();
  const routes = useApi<Route[]>('/admin/routes');
  const [f, setF] = useState({ sender_name: '', sender_phone: '', receiver_name: '', receiver_phone: '', route_id: '', stop_id: '', description: '', fee: '', mpesa_code: '' });
  const [payment, setPayment] = useState<Pay>('prompt');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<typeof f>) => setF((x) => ({ ...x, ...change }));
  const route = routes.data?.find((r) => String(r.id) === f.route_id);
  const phoneOk = (p: string) => /^(\+?254|0)?[17]\d{8}$/.test(p.replace(/\s/g, ''));
  const fee = /^\d+$/.test(f.fee.trim()) ? Number(f.fee.trim()) : NaN;

  const problems: string[] = [];
  if (f.sender_name.trim().length < 2) problems.push("Enter the sender's name.");
  if (!phoneOk(f.sender_phone)) problems.push("Enter the sender's Safaricom number, e.g. 0712345678.");
  if (f.receiver_name.trim().length < 2) problems.push("Enter the receiver's name.");
  if (!phoneOk(f.receiver_phone)) problems.push("Enter the receiver's phone number.");
  if (!route || !f.stop_id) problems.push('Choose the route and where the parcel is going.');
  if (!(fee > 0 && fee <= 100_000)) problems.push('Enter the fee in whole shillings.');
  if (payment === 'mpesa_code' && !/^[A-Za-z0-9]{8,12}$/.test(f.mpesa_code.trim())) problems.push('Enter the M-Pesa code from the payment SMS.');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const parcel = await api<Parcel>('/admin/parcels', {
        method: 'POST',
        body: {
          sender_name: f.sender_name.trim(),
          sender_phone: f.sender_phone.trim(),
          receiver_name: f.receiver_name.trim(),
          receiver_phone: f.receiver_phone.trim(),
          route_id: Number(f.route_id),
          stop_id: Number(f.stop_id),
          description: f.description.trim(),
          fee,
          payment,
          ...(payment === 'mpesa_code' && { mpesa_code: f.mpesa_code.trim() }),
        },
      });
      navigate(`/parcels/${parcel.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <>
      <p>
        <Link to="/parcels">← Parcels</Link>
      </p>
      <PageHead title="Record a parcel" subtitle="The sender gets a tracking code to share, and the receiver collects the parcel with a secret collection code." />
      <div className="card" style={{ maxWidth: 760 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label>
            Sender's name
            <input value={f.sender_name} onChange={(e) => set({ sender_name: e.target.value })} />
          </label>
          <label>
            Sender's M-Pesa number
            <input type="tel" value={f.sender_phone} onChange={(e) => set({ sender_phone: e.target.value })} placeholder="07XXXXXXXX" />
          </label>
          <label>
            Receiver's name
            <input value={f.receiver_name} onChange={(e) => set({ receiver_name: e.target.value })} />
          </label>
          <label>
            Receiver's phone number
            <input type="tel" value={f.receiver_phone} onChange={(e) => set({ receiver_phone: e.target.value })} placeholder="07XXXXXXXX" />
          </label>
          <label>
            Route
            <select value={f.route_id} onChange={(e) => set({ route_id: e.target.value, stop_id: '' })}>
              <option value="">Choose…</option>
              {routes.data?.filter((r) => r.is_active).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (from {r.origin})
                </option>
              ))}
            </select>
          </label>
          <label>
            Going to
            <select value={f.stop_id} onChange={(e) => set({ stop_id: e.target.value })} disabled={!route}>
              <option value="">Choose…</option>
              {route?.stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            What it is (optional)
            <input value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Box of books, 5 kg" />
          </label>
          <label>
            Fee (KES)
            <input value={f.fee} onChange={(e) => set({ fee: e.target.value })} inputMode="numeric" placeholder="e.g. 300" />
          </label>
        </div>
        <p style={{ marginBottom: 6, fontWeight: 600 }}>How the sender pays</p>
        <Chips
          options={[
            { value: 'prompt' as Pay, label: 'M-Pesa PIN prompt to the sender' },
            { value: 'cash' as Pay, label: 'Cash' },
            { value: 'mpesa_code' as Pay, label: 'Already paid by M-Pesa (enter code)' },
          ]}
          value={payment}
          onChange={setPayment}
        />
        {payment === 'mpesa_code' && (
          <label style={{ maxWidth: 320 }}>
            M-Pesa code
            <input value={f.mpesa_code} onChange={(e) => set({ mpesa_code: e.target.value })} placeholder="e.g. TKL12ABC90" />
          </label>
        )}
        {problems.length > 0 && <Banner>{problems[0]}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <button onClick={() => void save()} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : payment === 'prompt' ? `Record and send the PIN prompt${fee > 0 ? ` (${kes(fee)})` : ''}` : 'Record the parcel'}
        </button>
      </div>
    </>
  );
}

/** One parcel: its codes (printable receipt), where it is, its payment, and what the office can do next. */
export function ParcelDetail() {
  const { id } = useParams();
  const { data: p, setData, error, loading, reload } = useApi<Parcel>(`/admin/parcels/${id}`);
  const [dialog, setDialog] = useState<'cash' | 'code' | 'cancel' | 'collect' | null>(null);
  const [value, setValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // While a PIN prompt waits for the sender, look again every 5 seconds.
  const waiting = p?.status === 'awaiting_payment' && p.payments?.some((x) => ['initiating', 'pending'].includes(x.status));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  if (loading && !p) return <Loading />;
  if (!p) return <Failed message={error ?? 'Parcel not found'} onRetry={reload} />;
  const s = PARCEL_STATUS[p.status];
  const open = (d: typeof dialog) => {
    setValue('');
    setDialog(d);
  };
  const prompt = async () => {
    setActionError(null);
    try {
      setData(await api<Parcel>(`/admin/parcels/${p.id}/prompt`, { method: 'POST' }));
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  const events = [
    ['Recorded', p.created_at, `by ${p.created_by_name}`],
    ['Paid', p.paid_at, p.payment_method ? `${PAID_BY[p.payment_method]}${p.payment_reference ? ` ${p.payment_reference}` : ''}` : ''],
    ['Loaded onto a car', p.loaded_at, p.plate ?? ''],
    [`Arrived at ${p.stop_name}`, p.arrived_at, ''],
    ['Collected by the receiver', p.collected_at, p.collected_by_name ? `handed over by ${p.collected_by_name}` : ''],
    ['Cancelled', p.cancelled_at, p.cancel_reason ?? ''],
  ].filter(([, at]) => at) as [string, string, string][];

  return (
    <>
      <p>
        <Link to="/parcels">← Parcels</Link>
      </p>
      <PageHead title={`Parcel ${p.tracking_code}`} subtitle={`${p.origin} → ${p.stop_name} (${p.route_name})`}>
        <button className="secondary" onClick={() => window.print()}>
          Print receipt
        </button>
      </PageHead>
      <Banner tone={s.tone === 'danger' ? 'danger' : s.tone === 'success' ? 'success' : 'warning'}>
        {s.label}
        {p.status === 'awaiting_payment' && (waiting ? ': waiting for the sender to enter their M-Pesa PIN…' : '. Send the PIN prompt again, or record a cash or M-Pesa payment.')}
        {p.status === 'received' && ': paid, waiting for a car on this route to load it.'}
        {p.status === 'on_the_way' && p.plate && ` on ${p.plate}.`}
      </Banner>
      {actionError && <Banner tone="danger">{actionError}</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="kv"><span>Sender</span><span>{p.sender_name}, {displayPhone(p.sender_phone)}</span></div>
          <div className="kv"><span>Receiver</span><span>{p.receiver_name}, {displayPhone(p.receiver_phone)}</span></div>
          <div className="kv"><span>What it is</span><span>{p.description ?? '—'}</span></div>
          <div className="kv"><span>Fee</span><span>{kes(p.fee)}</span></div>
          <h2 style={{ fontSize: 16 }}>History</h2>
          {events.map(([what, at, note]) => (
            <div className="kv" key={what}>
              <span>{what}</span>
              <span>
                {dateTime(at)}
                {note && <span className="muted"> · {note}</span>}
              </span>
            </div>
          ))}
          {p.payments && p.payments.length > 0 && (
            <>
              <h2 style={{ fontSize: 16 }}>PIN prompts</h2>
              {p.payments.map((x) => (
                <div className="kv" key={x.id}>
                  <span>{dateTime(x.created_at)} to {displayPhone(x.phone)}</span>
                  <span>
                    {x.status === 'completed' ? <Badge tone="success">Paid {x.mpesa_receipt}</Badge> : x.status === 'failed' ? <Badge tone="danger">Not paid</Badge> : <Badge tone="warning">Waiting</Badge>}
                    {x.status === 'failed' && x.result_desc && <span className="muted"> {x.result_desc}</span>}
                  </span>
                </div>
              ))}
            </>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {p.status === 'awaiting_payment' && (
              <>
                <button onClick={() => void prompt()} disabled={waiting}>Send PIN prompt again</button>
                <button className="secondary" onClick={() => open('cash')}>Paid in cash</button>
                <button className="secondary" onClick={() => open('code')}>Paid by M-Pesa code</button>
              </>
            )}
            {['received', 'on_the_way', 'arrived'].includes(p.status) && <button onClick={() => open('collect')}>Hand over to the receiver</button>}
            {['awaiting_payment', 'received'].includes(p.status) && (
              <button className="danger" onClick={() => open('cancel')}>
                Cancel parcel
              </button>
            )}
          </div>
        </div>

        {/* The receipt for the sender: only this prints. */}
        <div className="sticker">
          <div className="title">Makos parcel receipt</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>Tracking code (share with the receiver)</p>
          <div className="plate">{p.tracking_code}</div>
          <p className="muted" style={{ margin: '10px 0 0' }}>Collection code (only for the receiver)</p>
          <div className="plate">{p.collection_code}</div>
          <div className="hint">
            {p.origin} → {p.stop_name} · {kes(p.fee)}
            <br />
            To {p.receiver_name}. Track it at the FarePay website, Parcels page.
          </div>
        </div>
      </div>

      {dialog === 'cash' && (
        <Dialog
          title={`Record ${kes(p.fee)} paid in cash?`}
          actionLabel="Paid in cash"
          action={async () => {
            setData(await api<Parcel>(`/admin/parcels/${p.id}/payment`, { method: 'POST', body: { method: 'cash' } }));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <p className="muted">Only once you have the cash.</p>
        </Dialog>
      )}
      {dialog === 'code' && (
        <Dialog
          title="Paid by M-Pesa"
          actionLabel="Record payment"
          disabled={!/^[A-Za-z0-9]{8,12}$/.test(value.trim())}
          action={async () => {
            setData(await api<Parcel>(`/admin/parcels/${p.id}/payment`, { method: 'POST', body: { method: 'mpesa_code', mpesa_code: value.trim() } }));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <label>
            M-Pesa code from the payment SMS
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. TKL12ABC90" />
          </label>
        </Dialog>
      )}
      {dialog === 'collect' && (
        <Dialog
          title={`Hand ${p.tracking_code} to ${p.receiver_name}?`}
          actionLabel="Handed over"
          disabled={!/^\d{6}$/.test(value.trim())}
          action={async () => {
            setData(await api<Parcel>(`/admin/parcels/${p.id}/collect`, { method: 'POST', body: { code: value.trim() } }));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <label>
            The receiver's 6-digit collection code
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" maxLength={6} />
          </label>
          <p className="muted">Ask the receiver for the code; don't read it out to them.</p>
        </Dialog>
      )}
      {dialog === 'cancel' && (
        <Dialog
          title={`Cancel parcel ${p.tracking_code}?`}
          actionLabel="Cancel parcel"
          danger
          disabled={value.trim().length < 3}
          action={async () => {
            setData(await api<Parcel>(`/admin/parcels/${p.id}/cancel`, { method: 'POST', body: { reason: value.trim() } }));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        >
          <label>
            Why
            <input value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          {p.paid_at && <p className="muted">The fee was paid: give it back to the sender yourself ({p.payment_method === 'cash' ? 'cash' : 'by M-Pesa'}). FarePay does not refund parcel fees.</p>}
        </Dialog>
      )}
    </>
  );
}
