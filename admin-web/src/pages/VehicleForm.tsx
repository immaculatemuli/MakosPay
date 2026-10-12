import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api';
import type { CrewMember, Route, Vehicle } from '../types';
import { Banner, Failed, Loading, PageHead } from '../ui';
import { useApi } from '../useApi';

type Form = {
  plate: string;
  description: string;
  owner_name: string;
  owner_phone: string;
  owner_payout_method: 'mpesa' | 'bank';
  owner_bank_name: string;
  owner_bank_paybill: string;
  owner_bank_account: string;
  route_id: string;
  conductor_id: string;
  driver_id: string;
};

const EMPTY: Form = {
  plate: '',
  description: '',
  owner_name: '',
  owner_phone: '',
  owner_payout_method: 'mpesa',
  owner_bank_name: '',
  owner_bank_paybill: '',
  owner_bank_account: '',
  route_id: '',
  conductor_id: '',
  driver_id: '',
};

const fromVehicle = (v: Vehicle): Form => ({
  plate: v.plate,
  description: v.description ?? '',
  owner_name: v.owner_name,
  owner_phone: v.owner_phone.startsWith('254') ? `0${v.owner_phone.slice(3)}` : v.owner_phone,
  owner_payout_method: v.owner_payout_method,
  owner_bank_name: v.owner_bank_name ?? '',
  owner_bank_paybill: v.owner_bank_paybill ?? '',
  owner_bank_account: v.owner_bank_account ?? '',
  route_id: v.route_id ? String(v.route_id) : '',
  conductor_id: v.conductor_id ? String(v.conductor_id) : '',
  driver_id: v.driver_id ? String(v.driver_id) : '',
});

/** Add a vehicle, or change one: owner and how they're paid, route, conductor and driver. */
export function VehicleForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const vehicle = useApi<Vehicle>(isNew ? null : `/admin/vehicles/${id}`);
  const routes = useApi<Route[]>('/admin/routes');
  const conductors = useApi<CrewMember[]>('/admin/conductors');
  const drivers = useApi<CrewMember[]>('/admin/drivers');
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vehicle.data) setForm(fromVehicle(vehicle.data));
  }, [vehicle.data]);

  if (!isNew && vehicle.loading && !vehicle.data) return <Loading />;
  if (!isNew && !vehicle.data) return <Failed message={vehicle.error ?? 'Vehicle not found'} onRetry={vehicle.reload} />;

  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));
  const bank = form.owner_payout_method === 'bank';
  const problems: string[] = [];
  if (isNew && form.plate.trim().length < 3) problems.push('Enter the number plate.');
  if (form.owner_name.trim().length < 2) problems.push("Enter the owner's name.");
  if (!/^(\+?254|0)?[17]\d{8}$/.test(form.owner_phone.replace(/\s/g, ''))) problems.push("Enter the owner's Safaricom number, e.g. 0712345678.");
  if (bank && (!form.owner_bank_name.trim() || !/^\d{5,7}$/.test(form.owner_bank_paybill.trim()) || !/^[A-Za-z0-9-]{4,30}$/.test(form.owner_bank_account.trim()))) {
    problems.push("For bank payouts: the bank's name, its M-Pesa paybill (5–7 digits) and the owner's account number.");
  }

  // Crew already on another vehicle can't be chosen (one vehicle each); switched-off accounts aren't offered.
  const available = (list: CrewMember[] | null, current: string) => (list ?? []).filter((c) => c.is_active && (!c.vehicle_id || String(c.vehicle_id) === id || String(c.id) === current));
  const num = (v: string) => (v ? Number(v) : null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      ...(isNew && { plate: form.plate.trim() }),
      description: form.description.trim(),
      owner_name: form.owner_name.trim(),
      owner_phone: form.owner_phone.trim(),
      owner_payout_method: form.owner_payout_method,
      owner_bank_name: bank ? form.owner_bank_name.trim() : null,
      owner_bank_paybill: bank ? form.owner_bank_paybill.trim() : null,
      owner_bank_account: bank ? form.owner_bank_account.trim() : null,
      route_id: num(form.route_id),
      conductor_id: num(form.conductor_id),
      driver_id: num(form.driver_id),
    };
    try {
      const saved = await api<Vehicle>(isNew ? '/admin/vehicles' : `/admin/vehicles/${id}`, { method: isNew ? 'POST' : 'PATCH', body });
      navigate(`/vehicles/${saved.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <>
      <p>
        <Link to={isNew ? '/vehicles' : `/vehicles/${id}`}>← {isNew ? 'All vehicles' : form.plate}</Link>
      </p>
      <PageHead title={isNew ? 'Add a vehicle' : `Edit ${form.plate}`} subtitle={isNew ? 'A QR sticker is made for it as soon as it is added.' : undefined} />
      <div className="card" style={{ maxWidth: 720 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label>
            Number plate
            <input value={form.plate} onChange={(e) => set({ plate: e.target.value })} disabled={!isNew} placeholder="e.g. KDA 123A" />
          </label>
          <label>
            Description (optional)
            <input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. White 33-seater" />
          </label>
          <label>
            Owner's name
            <input value={form.owner_name} onChange={(e) => set({ owner_name: e.target.value })} />
          </label>
          <label>
            Owner's M-Pesa number
            <input type="tel" value={form.owner_phone} onChange={(e) => set({ owner_phone: e.target.value })} placeholder="07XXXXXXXX" />
          </label>
          <label>
            Pay the owner's fares to
            <select value={form.owner_payout_method} onChange={(e) => set({ owner_payout_method: e.target.value as Form['owner_payout_method'] })}>
              <option value="mpesa">Their M-Pesa number</option>
              <option value="bank">A bank account (through the bank's M-Pesa paybill)</option>
            </select>
          </label>
        </div>
        {bank && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <label>
              Bank
              <input value={form.owner_bank_name} onChange={(e) => set({ owner_bank_name: e.target.value })} placeholder="e.g. Equity Bank" />
            </label>
            <label>
              Bank's M-Pesa paybill
              <input value={form.owner_bank_paybill} onChange={(e) => set({ owner_bank_paybill: e.target.value })} inputMode="numeric" placeholder="e.g. 247247" />
            </label>
            <label>
              Owner's account number
              <input value={form.owner_bank_account} onChange={(e) => set({ owner_bank_account: e.target.value })} />
            </label>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label>
            Route
            <select value={form.route_id} onChange={(e) => set({ route_id: e.target.value })}>
              <option value="">No route yet</option>
              {routes.data?.filter((r) => r.is_active || String(r.id) === form.route_id).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conductor
            <select value={form.conductor_id} onChange={(e) => set({ conductor_id: e.target.value })}>
              <option value="">None</option>
              {available(conductors.data, form.conductor_id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Driver
            <select value={form.driver_id} onChange={(e) => set({ driver_id: e.target.value })}>
              <option value="">None</option>
              {available(drivers.data, form.driver_id).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">Crew already working on another vehicle aren't listed: each conductor and driver works on one vehicle at a time.</p>
        {problems.length > 0 && <Banner>{problems[0]}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <button onClick={() => void save()} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : isNew ? 'Add vehicle' : 'Save changes'}
        </button>
      </div>
    </>
  );
}
