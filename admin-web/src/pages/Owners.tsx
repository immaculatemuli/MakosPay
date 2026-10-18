import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { dateTime, displayPhone, kes, plural } from '../format';
import { Badge, Banner, Dialog, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

interface OwnerRow {
  id: number;
  name: string;
  phone: string;
  payout_method: 'mpesa' | 'bank';
  bank_name: string | null;
  vehicle_count: number;
  today_total: number;
  owed: number;
}

interface Owner {
  id: number;
  name: string;
  phone: string;
  id_number: string | null;
  payout_method: 'mpesa' | 'bank';
  bank_name: string | null;
  bank_paybill: string | null;
  bank_account: string | null;
  vehicle_count: number;
}

interface OwnerDetailData {
  owner: Owner;
  vehicles: { id: number; plate: string; is_active: boolean | number; route_name: string | null; today_payments: number; today_total: number; unpaid: number }[];
  owed: number;
  refunds_to_take_back: number;
  payouts: { id: number; amount: number; trip_count: number; status: string; method: string; reference: string | null; created_at: string }[];
}

const paidBy = (o: { payout_method: string; bank_name: string | null }) => (o.payout_method === 'bank' ? `Bank (${o.bank_name ?? ''})` : 'M-Pesa');

/** Vehicle owners: each set up once with how they are paid; all their cars' fares are paid to them together every evening. */
export function Owners() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const { data, error, loading, reload } = useApi<OwnerRow[]>(`/admin/owners${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [adding, setAdding] = useState(false);
  const totalCars = data?.reduce((n, o) => n + o.vehicle_count, 0) ?? 0;

  return (
    <>
      <PageHead title="Vehicle owners" subtitle="One owner can have many cars. Every evening each owner gets one payment for all their cars’ fares.">
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="search" placeholder="Name or phone" aria-label="Search owners" value={text} onChange={(e) => setText(e.target.value)} />
          <button onClick={() => setAdding(true)}>Add owner</button>
        </div>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && <p className="muted">{plural(data.length, 'owner')} with {plural(totalCars, 'car')}{q ? ' found' : ''}.</p>}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Owner</th>
                <th>Phone</th>
                <th className="num">Cars</th>
                <th>Paid by</th>
                <th className="num">Today</th>
                <th className="num">To be paid</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/owners/${o.id}`)}>
                  <td>
                    <Link to={`/owners/${o.id}`}>{o.name}</Link>
                  </td>
                  <td>{displayPhone(o.phone)}</td>
                  <td className="num">{o.vehicle_count}</td>
                  <td>{paidBy(o)}</td>
                  <td className="num">{kes(o.today_total)}</td>
                  <td className="num">{kes(o.owed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <OwnerDialog onClose={() => setAdding(false)} onSaved={(o) => navigate(`/owners/${o.id}`)} />}
    </>
  );
}

/** One owner: their cars with today’s takings, what the next payout will be, their payouts, and their details. */
export function OwnerPage() {
  const { id } = useParams();
  const { data: d, error, loading, reload } = useApi<OwnerDetailData>(`/admin/owners/${id}`);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  if (loading && !d) return <Loading />;
  if (!d) return <Failed message={error ?? 'Owner not found'} onRetry={reload} />;
  const o = d.owner;
  const today = d.vehicles.reduce((n, v) => n + v.today_total, 0);

  return (
    <>
      <p>
        <Link to="/owners">← All owners</Link>
      </p>
      <PageHead title={o.name} subtitle={`${plural(o.vehicle_count, 'car')} · ${displayPhone(o.phone)}`}>
        <button className="secondary" onClick={() => setEditing(true)}>
          Change details
        </button>
      </PageHead>
      {saved && <Banner tone="success">Saved. All {plural(o.vehicle_count, 'car')} now use these details.</Banner>}
      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="card stat">
          <div className="label">Collected today (all cars)</div>
          <div className="value">{kes(today)}</div>
        </div>
        <div className="card stat">
          <div className="label">Next payout (tonight)</div>
          <div className="value">{kes(d.owed)}</div>
        </div>
        <div className="card stat">
          <div className="label">Paid to</div>
          <div className="value" style={{ fontSize: 20 }}>
            {o.payout_method === 'bank' ? `${o.bank_name}, paybill ${o.bank_paybill}, acc ${o.bank_account}` : `M-Pesa ${displayPhone(o.phone)}`}
          </div>
        </div>
      </div>
      {d.refunds_to_take_back > 0 && <Banner>{kes(d.refunds_to_take_back)} of refunds will be taken off the next payout.</Banner>}

      <h2>Cars</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plate</th>
              <th>Route</th>
              <th className="num">Payments today</th>
              <th className="num">Today</th>
              <th className="num">Not yet paid out</th>
            </tr>
          </thead>
          <tbody>
            {d.vehicles.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link to={`/vehicles/${v.id}`}>{v.plate}</Link> {!v.is_active && <Badge tone="danger">Not in use</Badge>}
                </td>
                <td>{v.route_name ?? '—'}</td>
                <td className="num">{v.today_payments}</td>
                <td className="num">{kes(v.today_total)}</td>
                <td className="num">{kes(v.unpaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Payouts</h2>
      {d.payouts.length === 0 ? (
        <p className="muted">No payouts yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th className="num">Fares</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>M-Pesa code</th>
              </tr>
            </thead>
            <tbody>
              {d.payouts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/payouts/${p.id}`}>{dateTime(p.created_at)}</Link>
                  </td>
                  <td className="num">{p.trip_count}</td>
                  <td className="num">{kes(p.amount)}</td>
                  <td>{p.status}</td>
                  <td>{p.reference ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <OwnerDialog
          owner={o}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            void reload();
          }}
        />
      )}
    </>
  );
}

/** Add an owner, or change one (a change reaches all their cars; a new phone takes their unpaid fares with it). */
function OwnerDialog({ owner, onClose, onSaved }: { owner?: Owner; onClose: () => void; onSaved: (o: Owner) => void }) {
  const [f, setF] = useState({
    name: owner?.name ?? '',
    phone: owner ? displayPhone(owner.phone) : '',
    id_number: owner?.id_number ?? '',
    payout_method: owner?.payout_method ?? 'mpesa',
    bank_name: owner?.bank_name ?? '',
    bank_paybill: owner?.bank_paybill ?? '',
    bank_account: owner?.bank_account ?? '',
  });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const bank = f.payout_method === 'bank';
  const ok = f.name.trim().length >= 2 && f.phone.trim().length >= 9 && (!bank || (f.bank_name.trim() && /^\d{5,7}$/.test(f.bank_paybill.trim()) && f.bank_account.trim().length >= 4));
  return (
    <Dialog
      title={owner ? `Change ${owner.name}` : 'Add an owner'}
      actionLabel="Save"
      disabled={!ok}
      action={async () => {
        const body = {
          name: f.name.trim(),
          phone: f.phone.trim(),
          id_number: f.id_number.trim() || null,
          payout_method: f.payout_method,
          bank_name: bank ? f.bank_name.trim() : null,
          bank_paybill: bank ? f.bank_paybill.trim() : null,
          bank_account: bank ? f.bank_account.trim() : null,
        };
        onSaved(await api<Owner>(owner ? `/admin/owners/${owner.id}` : '/admin/owners', { method: owner ? 'PATCH' : 'POST', body }));
      }}
      onClose={onClose}
    >
      {owner && owner.vehicle_count > 1 && <p className="muted">These details are used for all {owner.vehicle_count} of their cars.</p>}
      <label>
        Full name
        <input value={f.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label>
        M-Pesa phone number
        <input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="07XXXXXXXX" />
      </label>
      <label>
        ID number (optional)
        <input value={f.id_number} onChange={(e) => set({ id_number: e.target.value })} />
      </label>
      <label>
        Pay their fares to
        <select value={f.payout_method} onChange={(e) => set({ payout_method: e.target.value as 'mpesa' | 'bank' })}>
          <option value="mpesa">Their M-Pesa number</option>
          <option value="bank">A bank account (through the bank’s M-Pesa paybill)</option>
        </select>
      </label>
      {bank && (
        <>
          <label>
            Bank name
            <input value={f.bank_name} onChange={(e) => set({ bank_name: e.target.value })} placeholder="e.g. KCB" />
          </label>
          <label>
            Bank’s M-Pesa paybill
            <input value={f.bank_paybill} onChange={(e) => set({ bank_paybill: e.target.value })} placeholder="5 to 7 digits" />
          </label>
          <label>
            Account number
            <input value={f.bank_account} onChange={(e) => set({ bank_account: e.target.value })} />
          </label>
        </>
      )}
    </Dialog>
  );
}
