import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Button, Chips, ErrorBox, Field, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import type { Conductor, Route, Vehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Add a vehicle (no id) or edit one (?id=). The plate can't change once added. */
export default function VehicleForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const vehicle = useApi<Vehicle>(id ? `/admin/vehicles/${id}` : null);
  const routes = useApi<Route[]>('/admin/routes');
  const conductors = useApi<Conductor[]>('/admin/conductors');
  const drivers = useApi<Conductor[]>('/admin/drivers');
  const existing = vehicle.data;

  const [plate, setPlate] = useState('');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [conductorId, setConductorId] = useState<number | null>(null);
  const [driverId, setDriverId] = useState<number | null>(null);
  const [routeId, setRouteId] = useState<number | null>(null);
  const [payoutMethod, setPayoutMethod] = useState<'mpesa' | 'bank'>('mpesa');
  const [bankName, setBankName] = useState('');
  const [bankPaybill, setBankPaybill] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [seats, setSeats] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!existing || prefilled.current) return;
    prefilled.current = true;
    setDescription(existing.description ?? '');
    setOwnerName(existing.owner_name);
    setOwnerPhone(displayPhone(existing.owner_phone));
    setConductorId(existing.conductor_id);
    setDriverId(existing.driver_id);
    setRouteId(existing.route_id);
    setPayoutMethod(existing.owner_payout_method);
    setBankName(existing.owner_bank_name ?? '');
    setBankPaybill(existing.owner_bank_paybill ?? '');
    setBankAccount(existing.owner_bank_account ?? '');
    setSeats(String(existing.seats ?? 14));
  }, [existing]);

  if ((id && vehicle.loading && !existing) || (routes.loading && !routes.data) || (conductors.loading && !conductors.data) || (drivers.loading && !drivers.data)) return <Loading />;
  const loadError = vehicle.error ?? routes.error ?? conductors.error ?? drivers.error;

  // Conductors who are free, plus this vehicle's own conductor.
  const freeConductors = (conductors.data ?? []).filter((c) => c.is_active && (!c.vehicle_id || c.id === existing?.conductor_id));
  const freeDrivers = (drivers.data ?? []).filter((d) => d.is_active && (!d.vehicle_id || d.id === existing?.driver_id));
  const activeRoutes = (routes.data ?? []).filter((r) => r.is_active || r.id === existing?.route_id);

  const bankValid = payoutMethod === 'mpesa' || (bankName.trim().length >= 2 && /^\d{5,7}$/.test(bankPaybill.trim()) && bankAccount.trim().length >= 4);
  const seatCount = Number(seats);
  const seatsValid = Number.isInteger(seatCount) && seatCount >= 1 && seatCount <= 80;
  const valid = (id || plate.trim().length >= 3) && ownerName.trim().length >= 2 && ownerPhone.trim().length >= 9 && bankValid && seatsValid;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        description: description.trim(),
        owner_name: ownerName.trim(),
        owner_phone: ownerPhone.trim(),
        owner_payout_method: payoutMethod,
        ...(payoutMethod === 'bank' && {
          owner_bank_name: bankName.trim(),
          owner_bank_paybill: bankPaybill.trim(),
          owner_bank_account: bankAccount.trim(),
        }),
        conductor_id: conductorId,
        driver_id: driverId,
        route_id: routeId,
        seats: seatCount,
      };
      if (id) {
        await api(`/admin/vehicles/${id}`, { method: 'PATCH', body });
        router.back();
      } else {
        const created = await api<Vehicle>('/admin/vehicles', { method: 'POST', body: { ...body, plate: plate.trim() } });
        router.replace(`/admin/vehicle/${created.id}`); // straight to its QR sticker
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {loadError && <ErrorBox message={loadError} />}
      <SectionTitle>Vehicle</SectionTitle>
      {!id && <Field label="Number plate" placeholder="e.g. KDA 123A" autoCapitalize="characters" value={plate} onChangeText={setPlate} />}
      <Field
        label="Description (optional)"
        placeholder='e.g. White Nissan "Baraka"'
        value={description}
        onChangeText={setDescription}
        hint="Helps passengers check they are in the right vehicle"
      />
      <Field
        label="Passenger seats"
        keyboardType="number-pad"
        value={seats}
        onChangeText={(t) => setSeats(t.replace(/\D/g, ''))}
        hint={seatsValid ? 'How many seats passengers can book on this vehicle' : 'A number from 1 to 80'}
      />

      <SectionTitle>Owner (receives the fares)</SectionTitle>
      <Field label="Owner's name" value={ownerName} onChangeText={setOwnerName} />
      <Field
        label="Owner's phone number"
        placeholder="07XX XXX XXX"
        keyboardType="phone-pad"
        value={ownerPhone}
        onChangeText={setOwnerPhone}
        hint={payoutMethod === 'mpesa' ? 'The day’s fares are sent to this M-Pesa number once a day' : 'Used to identify the owner'}
      />
      <Chips
        label="Pay the owner to"
        options={[
          { value: 'mpesa' as const, label: 'M-Pesa' },
          { value: 'bank' as const, label: 'Bank account' },
        ]}
        value={payoutMethod}
        onChange={setPayoutMethod}
      />
      {payoutMethod === 'bank' && (
        <>
          <Field label="Bank name" placeholder="e.g. Equity Bank" value={bankName} onChangeText={setBankName} />
          <Field
            label="Bank's M-Pesa paybill number"
            placeholder="e.g. 247247"
            keyboardType="number-pad"
            value={bankPaybill}
            onChangeText={(t) => setBankPaybill(t.replace(/\D/g, ''))}
            hint="Check the number with the bank before saving. Money is sent here."
          />
          <Field label="Owner's bank account number" autoCapitalize="characters" value={bankAccount} onChangeText={setBankAccount} />
        </>
      )}

      <SectionTitle>On the road</SectionTitle>
      {activeRoutes.length === 0 ? (
        <Muted>Add a route first (Routes tab).</Muted>
      ) : (
        <Chips
          label="Route"
          options={[{ value: null, label: 'None yet' }, ...activeRoutes.map((r) => ({ value: r.id, label: r.name }))]}
          value={routeId}
          onChange={setRouteId}
        />
      )}
      <Chips
        label="Conductor"
        options={[{ value: null, label: 'None' }, ...freeConductors.map((c) => ({ value: c.id, label: c.name }))]}
        value={conductorId}
        onChange={setConductorId}
      />
      {freeConductors.length === 0 && <Muted>No free conductors. Add one from Home → Conductors.</Muted>}
      <Chips
        label="Driver"
        options={[{ value: null, label: 'None' }, ...freeDrivers.map((d) => ({ value: d.id, label: d.name }))]}
        value={driverId}
        onChange={setDriverId}
      />
      {freeDrivers.length === 0 && <Muted>No free drivers. Add one from Home → Drivers.</Muted>}

      {error && <ErrorBox message={error} />}
      <Button title={id ? 'Save changes' : 'Add vehicle'} onPress={save} loading={busy} disabled={!valid} />
    </Screen>
  );
}
