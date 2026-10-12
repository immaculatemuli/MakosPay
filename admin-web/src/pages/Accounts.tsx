import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { dateTime, displayPhone, kes } from '../format';
import { Badge, Banner, Dialog, Failed, Loading, PageHead, Stat } from '../ui';
import { useApi } from '../useApi';

interface Account {
  id: number;
  name: string;
  phone: string;
  is_active: number;
  created_at: string;
}

/** A list of office-type accounts that can be added and switched off (never your own). */
function AccountList({ path, what, intro }: { path: string; what: string; intro: string }) {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<Account[]>(path);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', password: '' });
  const [toggle, setToggle] = useState<Account | null>(null);
  return (
    <>
      <PageHead title={`${what[0].toUpperCase()}${what.slice(1)}s`} subtitle={intro}>
        <button onClick={() => setAdding(true)}>Add {what}</button>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Added</th>
                <th>Account</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.name} {a.id === user?.id && <span className="muted">(you)</span>}
                  </td>
                  <td>{displayPhone(a.phone)}</td>
                  <td>{dateTime(a.created_at)}</td>
                  <td>{a.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Switched off</Badge>}</td>
                  <td>
                    {a.id !== user?.id && (
                      <button className="secondary" onClick={() => setToggle(a)}>
                        {a.is_active ? 'Switch off' : 'Switch on'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <Dialog
          title={`Add ${what}`}
          actionLabel={`Add ${what}`}
          disabled={form.name.trim().length < 2 || form.phone.trim().length < 9 || form.password.length < 6}
          action={async () => {
            await api(path, { method: 'POST', body: { name: form.name.trim(), phone: form.phone.trim(), password: form.password } });
            setAdding(false);
            setForm({ name: '', phone: '', password: '' });
            await reload();
          }}
          onClose={() => setAdding(false)}
        >
          <p className="muted">They sign in (app or web dashboard) with this phone number and password. Ask them to change the password after their first sign-in.</p>
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Phone number
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="07XXXXXXXX" />
          </label>
          <label>
            Password (at least 6 characters)
            <input type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
        </Dialog>
      )}
      {toggle && (
        <Dialog
          title={toggle.is_active ? `Switch ${toggle.name} off?` : `Switch ${toggle.name} back on?`}
          actionLabel={toggle.is_active ? 'Switch off' : 'Switch on'}
          danger={Boolean(toggle.is_active)}
          action={async () => {
            await api(`${path}/${toggle.id}`, { method: 'PATCH', body: { is_active: !toggle.is_active } });
            setToggle(null);
            await reload();
          }}
          onClose={() => setToggle(null)}
        >
          <p className="muted">{toggle.is_active ? 'They are signed out everywhere and can’t sign in until switched back on.' : 'They can sign in again.'}</p>
        </Dialog>
      )}
    </>
  );
}

export const Staff = () => <AccountList path="/admin/staff" what="office account" intro="Everyone who works in the SACCO office. Nobody can switch off their own account." />;

interface SystemInfo {
  payments_by: string;
  live: boolean;
  mpesa_payments_enabled: boolean;
  automatic_payouts_enabled: boolean;
  daily_payout_at: string;
  wallet_limits: { min_topup: number; max_topup: number; max_balance: number };
  counts: { passengers: number; crew: number; office: number; vehicles: number };
}

/** For whoever runs FarePay itself: how money moves right now, and the platform admin accounts. */
export function Platform() {
  const sys = useApi<SystemInfo>('/platform/system');
  const s = sys.data;
  return (
    <>
      {sys.error && <Failed message={sys.error} onRetry={sys.reload} />}
      {s && (
        <>
          <Banner tone={s.live ? 'danger' : 'warning'}>
            {s.live ? 'REAL MONEY: M-Pesa is live. Every payment and payout moves real money.' : `Test mode: ${s.payments_by}. No real money moves.`}
          </Banner>
          <div className="stats" style={{ marginBottom: 8 }}>
            <Stat label="Passengers" value={s.counts.passengers} />
            <Stat label="Crew" value={s.counts.crew} />
            <Stat label="Office accounts" value={s.counts.office} />
            <Stat label="Vehicles in use" value={s.counts.vehicles} />
          </div>
          <div className="card" style={{ marginBottom: 8 }}>
            <div className="kv"><span>Payments by</span><span>{s.payments_by}</span></div>
            <div className="kv"><span>M-Pesa top-ups and fares</span><span>{s.mpesa_payments_enabled ? 'On' : 'Off (keys missing)'}</span></div>
            <div className="kv"><span>Automatic owner payouts</span><span>{s.automatic_payouts_enabled ? `On, daily at ${s.daily_payout_at}` : 'Off: the office sends payouts itself'}</span></div>
            <div className="kv"><span>Wallet top-up</span><span>{kes(s.wallet_limits.min_topup)} – {kes(s.wallet_limits.max_topup)}</span></div>
            <div className="kv"><span>Most a wallet can hold</span><span>{kes(s.wallet_limits.max_balance)}</span></div>
          </div>
          <p className="muted">These settings are changed on the server (backend .env), not here.</p>
        </>
      )}
      <AccountList path="/platform/admins" what="platform admin" intro="Platform admins can do everything the office can, plus this page." />
    </>
  );
}
