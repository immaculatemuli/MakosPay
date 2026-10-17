import { useState } from 'react';
import { api } from '../api';
import { dateTime, displayPhone, kes } from '../format';
import type { CrewMember, PassengerRow } from '../types';
import { Badge, Chips, Dialog, Failed, Loading, PageHead, PasswordInput } from '../ui';
import { useApi } from '../useApi';

/** The office sets a new password for someone who forgot theirs (they are signed out everywhere). */
export function SetPassword({ person, onClose }: { person: { id: number; name: string }; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <Dialog key="done" title="Password changed" actionLabel="Done" action={async () => onClose()} onClose={onClose}>
        <p className="muted">Tell {person.name} the new password in person or by phone. They have been signed out on every phone.</p>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={`New password for ${person.name}`}
      actionLabel="Set password"
      disabled={password.length < 6}
      action={async () => {
        await api(`/admin/users/${person.id}/password`, { method: 'POST', body: { new_password: password } });
        setDone(true);
      }}
      onClose={onClose}
    >
      <label>
        New password (at least 6 characters)
        <PasswordInput value={password} onChange={setPassword} />
      </label>
    </Dialog>
  );
}

const ROLES = [
  { value: 'conductor', label: 'Conductors' },
  { value: 'driver', label: 'Drivers' },
] as const;

/** Conductors and drivers: add their sign-in, switch them off (frees their vehicle), reset passwords, delete. */
export function Crew() {
  const [role, setRole] = useState<'conductor' | 'driver'>('conductor');
  const path = role === 'conductor' ? '/admin/conductors' : '/admin/drivers';
  const { data, error, loading, reload } = useApi<CrewMember[]>(path);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', password: '' });
  const [toggle, setToggle] = useState<CrewMember | null>(null);
  const [password, setPassword] = useState<CrewMember | null>(null);
  const [remove, setRemove] = useState<CrewMember | null>(null);
  const word = role === 'conductor' ? 'conductor' : 'driver';

  return (
    <>
      <PageHead title="Crew" subtitle="Put a conductor or driver on a vehicle from the vehicle's page in the app.">
        <div style={{ display: 'flex', gap: 10 }}>
          <Chips options={[...ROLES]} value={role} onChange={setRole} />
          <button onClick={() => setAdding(true)}>Add {word}</button>
        </div>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">No {word}s yet.</p>}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Vehicle</th>
                <th>Account</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{displayPhone(c.phone)}</td>
                  <td>{c.vehicle_plate ?? '—'}</td>
                  <td>{c.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Switched off</Badge>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary" onClick={() => setPassword(c)}>
                      New password
                    </button>{' '}
                    <button className="secondary" onClick={() => setToggle(c)}>
                      {c.is_active ? 'Switch off' : 'Switch on'}
                    </button>{' '}
                    <button className="secondary" onClick={() => setRemove(c)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <Dialog
          title={`Add a ${word}`}
          actionLabel={`Add ${word}`}
          disabled={form.name.trim().length < 2 || form.phone.trim().length < 9 || form.password.length < 6}
          action={async () => {
            await api(path, { method: 'POST', body: { name: form.name.trim(), phone: form.phone.trim(), password: form.password } });
            setAdding(false);
            setForm({ name: '', phone: '', password: '' });
            await reload();
          }}
          onClose={() => setAdding(false)}
        >
          <p className="muted">They sign in to the FarePay app with this phone number and password.</p>
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
            <PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
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
          <p className="muted">
            {toggle.is_active
              ? `They are signed out and can't sign in.${toggle.vehicle_plate ? ` ${toggle.vehicle_plate} is freed for another ${word}.` : ''}`
              : 'They can sign in again. Put them back on a vehicle from the vehicle’s page in the app.'}
          </p>
        </Dialog>
      )}
      {remove && (
        <Dialog
          title={`Delete ${remove.name}?`}
          actionLabel="Delete"
          danger
          action={async () => {
            await api(`${path}/${remove.id}/delete`, { method: 'POST' });
            setRemove(null);
            await reload();
          }}
          onClose={() => setRemove(null)}
        >
          <p className="muted">
            Their account, name and phone number are removed from FarePay{remove.vehicle_plate ? ` and they are taken off ${remove.vehicle_plate}` : ''}.
            Payments and trips they worked stay in the records as “Deleted {word}”. This can't be undone.
          </p>
        </Dialog>
      )}
      {password && <SetPassword person={password} onClose={() => setPassword(null)} />}
    </>
  );
}

/** Passengers, newest first, with their wallet balance; search by name or phone; reset a forgotten password. */
export function Passengers() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi<PassengerRow[]>(`/admin/passengers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const [password, setPassword] = useState<PassengerRow | null>(null);
  return (
    <>
      <PageHead title="Passengers" subtitle="The 100 newest, or search by name or phone number.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search.trim());
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or phone" aria-label="Search passengers" />
          <button type="submit">Search</button>
        </form>
      </PageHead>
      {error && <Failed message={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.length === 0 && <p className="muted">No passengers found.</p>}
      {!!data?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Joined</th>
                <th className="num">Wallet</th>
                <th className="num">Fares paid</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name} {!p.is_active && <Badge tone="danger">Deleted / off</Badge>}
                  </td>
                  <td>{displayPhone(p.phone)}</td>
                  <td>{dateTime(p.created_at)}</td>
                  <td className="num">{kes(p.wallet_balance ?? 0)}</td>
                  <td className="num">{p.trips}</td>
                  <td>
                    {p.is_active ? (
                      <button className="secondary" onClick={() => setPassword(p)}>
                        New password
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {password && <SetPassword person={password} onClose={() => setPassword(null)} />}
    </>
  );
}
