import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Chips, ErrorBox, Field, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes } from '@/lib/format';
import type { OfficeParcel, Route } from '@/lib/types';
import { useApi } from '@/lib/useApi';

type Pay = 'prompt' | 'cash' | 'mpesa_code';
const phoneOk = (p: string) => /^(\+?254|0)?[17]\d{8}$/.test(p.replace(/\s/g, ''));

/** Record a parcel at the counter and take the fee: M-Pesa PIN prompt to the sender, cash, or an M-Pesa code. */
export default function ParcelForm() {
  const routes = useApi<Route[]>('/admin/routes');
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [routeId, setRouteId] = useState<number | null>(null);
  const [stopId, setStopId] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [fee, setFee] = useState('');
  const [payment, setPayment] = useState<Pay>('prompt');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (routes.loading && !routes.data) return <Loading />;
  const active = (routes.data ?? []).filter((r) => r.is_active);
  const route = active.find((r) => r.id === routeId);
  const feeNumber = Number(fee);
  const valid =
    senderName.trim().length >= 2 &&
    phoneOk(senderPhone) &&
    receiverName.trim().length >= 2 &&
    phoneOk(receiverPhone) &&
    route &&
    stopId &&
    feeNumber > 0 &&
    feeNumber <= 100_000 &&
    (payment !== 'mpesa_code' || /^[A-Za-z0-9]{8,12}$/.test(code.trim()));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const parcel = await api<OfficeParcel>('/admin/parcels', {
        method: 'POST',
        body: {
          sender_name: senderName.trim(),
          sender_phone: senderPhone.trim(),
          receiver_name: receiverName.trim(),
          receiver_phone: receiverPhone.trim(),
          route_id: routeId,
          stop_id: stopId,
          description: description.trim(),
          fee: feeNumber,
          payment,
          ...(payment === 'mpesa_code' && { mpesa_code: code.trim() }),
        },
      });
      router.replace({ pathname: '/admin/parcel/[id]', params: { id: String(parcel.id) } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle>Sender</SectionTitle>
      <Field label="Sender's name" value={senderName} onChangeText={setSenderName} />
      <Field label="Sender's M-Pesa number" placeholder="07XX XXX XXX" keyboardType="phone-pad" value={senderPhone} onChangeText={setSenderPhone} />
      <SectionTitle>Receiver</SectionTitle>
      <Field label="Receiver's name" value={receiverName} onChangeText={setReceiverName} />
      <Field label="Receiver's phone number" placeholder="07XX XXX XXX" keyboardType="phone-pad" value={receiverPhone} onChangeText={setReceiverPhone} />
      <SectionTitle>Parcel</SectionTitle>
      <Chips
        label="Route"
        options={active.map((r) => ({ value: r.id as number | null, label: r.name }))}
        value={routeId}
        onChange={(v) => {
          setRouteId(v);
          setStopId(null);
        }}
      />
      {route && <Chips label="Going to" options={route.stops.map((s) => ({ value: s.id as number | null, label: s.name }))} value={stopId} onChange={setStopId} />}
      <Field label="What it is (optional)" placeholder="e.g. Box of books, 5 kg" value={description} onChangeText={setDescription} />
      <Field label="Fee (KES)" keyboardType="number-pad" value={fee} onChangeText={(t) => setFee(t.replace(/\D/g, ''))} />
      <Chips
        label="How the sender pays"
        options={[
          { value: 'prompt' as Pay, label: 'M-Pesa PIN prompt' },
          { value: 'cash' as Pay, label: 'Cash' },
          { value: 'mpesa_code' as Pay, label: 'M-Pesa code' },
        ]}
        value={payment}
        onChange={setPayment}
      />
      {payment === 'mpesa_code' && <Field label="M-Pesa code from the payment SMS" autoCapitalize="characters" value={code} onChangeText={setCode} />}
      {payment === 'prompt' && <Muted>The sender gets the M-Pesa PIN prompt on their phone{feeNumber > 0 ? ` for ${kes(feeNumber)}` : ''}.</Muted>}
      {error && <ErrorBox message={error} />}
      <Button title={payment === 'prompt' ? 'Record and send the PIN prompt' : 'Record the parcel'} icon="cube-outline" disabled={!valid} loading={busy} onPress={() => void save()} />
    </Screen>
  );
}
