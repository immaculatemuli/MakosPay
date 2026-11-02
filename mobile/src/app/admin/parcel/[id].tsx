import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { Badge, Button, Card, colors, ErrorBox, Field, KeyValue, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes } from '@/lib/format';
import type { OfficeParcel } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { PARCEL_WORD } from '@/lib/parcels';

const displayPhone = (p: string) => (p.startsWith('254') ? `0${p.slice(3)}` : p);
const PAID_BY = { mpesa_prompt: 'M-Pesa (PIN prompt)', mpesa_code: 'M-Pesa', cash: 'Cash' } as const;

/** One parcel (?id=): its codes (share them with the sender), history, payment, and what the office can do next. */
export default function ParcelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const parcel = useApi<OfficeParcel>(`/admin/parcels/${id}`);
  const [form, setForm] = useState<'code' | 'collect' | 'cancel' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = parcel.data;

  // While a PIN prompt waits for the sender, look again every 5 seconds.
  const { reload } = parcel;
  const waiting = p?.status === 'awaiting_payment' && Boolean(p.payments?.some((x) => ['initiating', 'pending'].includes(x.status)));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  if (parcel.loading && !p) return <Loading />;
  if (!p) return <Screen><ErrorBox message={parcel.error ?? 'Parcel not found'} onRetry={parcel.reload} /></Screen>;

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      parcel.setData(await api<OfficeParcel>(path, { method: 'POST', body }));
      setForm(null);
      setValue('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const open = (f: typeof form) => {
    setValue('');
    setError(null);
    setForm(f);
  };
  const share = () =>
    Share.share({
      message: `Makos parcel ${p.origin} → ${p.stop_name} for ${p.receiver_name}.\nTracking code: ${p.tracking_code} (track it on the FarePay website, Parcels page).\nCollection code: ${p.collection_code} (only for the receiver, to collect the parcel).`,
    });

  const events = [
    ['Recorded', p.created_at, `by ${p.created_by_name}`],
    ['Paid', p.paid_at, p.payment_method ? `${PAID_BY[p.payment_method]}${p.payment_reference ? ` ${p.payment_reference}` : ''}` : ''],
    ['Loaded onto a car', p.loaded_at, p.plate ?? ''],
    [`Arrived at ${p.stop_name}`, p.arrived_at, ''],
    ['Collected', p.collected_at, p.collected_by_name ? `by ${p.collected_by_name}` : ''],
    ['Cancelled', p.cancelled_at, p.cancel_reason ?? ''],
  ].filter(([, at]) => at) as [string, string, string][];

  return (
    <Screen refreshing={parcel.refreshing} onRefresh={parcel.refresh}>
      <Card>
        <View style={{ alignItems: 'center' }}>
          <Badge text={PARCEL_WORD[p.status]} tone={p.status === 'cancelled' ? 'danger' : ['arrived', 'collected'].includes(p.status) ? 'success' : 'warning'} />
          <Muted>Tracking code</Muted>
          <Text style={{ fontSize: 30, fontWeight: '800', letterSpacing: 3, color: colors.text }}>{p.tracking_code}</Text>
          <Muted>Collection code (only for the receiver)</Muted>
          <Text style={{ fontSize: 30, fontWeight: '800', letterSpacing: 6, color: colors.text }}>{p.collection_code}</Text>
          <Text style={{ color: colors.text, marginTop: 4 }}>
            {p.origin} → {p.stop_name} · {kes(p.fee)}
          </Text>
        </View>
        <Button title="Share codes with the sender" variant="secondary" icon="share-outline" onPress={() => void share()} />
      </Card>
      {p.status === 'awaiting_payment' && (
        <Muted>{waiting ? 'Waiting for the sender to enter their M-Pesa PIN…' : 'Not paid yet: send the PIN prompt again, or record a cash or M-Pesa payment.'}</Muted>
      )}

      <Card>
        <KeyValue label="Sender" value={`${p.sender_name}, ${displayPhone(p.sender_phone)}`} />
        <KeyValue label="Receiver" value={`${p.receiver_name}, ${displayPhone(p.receiver_phone)}`} />
        <KeyValue label="What it is" value={p.description ?? '—'} />
      </Card>

      <SectionTitle>History</SectionTitle>
      <Card>
        {events.map(([what, at, note]) => (
          <KeyValue key={what} label={what} value={`${dateTime(at)}${note ? ` · ${note}` : ''}`} />
        ))}
      </Card>

      {error && <ErrorBox message={error} />}
      {form === 'code' && (
        <Card>
          <Field label="M-Pesa code from the payment SMS" autoCapitalize="characters" value={value} onChangeText={setValue} />
          <Button title="Record payment" disabled={!/^[A-Za-z0-9]{8,12}$/.test(value.trim())} loading={busy} onPress={() => void act(`/admin/parcels/${p.id}/payment`, { method: 'mpesa_code', mpesa_code: value.trim() })} />
          <Button title="Not now" variant="secondary" onPress={() => setForm(null)} />
        </Card>
      )}
      {form === 'collect' && (
        <Card>
          <Field
            label="Receiver's 6-digit collection code"
            keyboardType="number-pad"
            maxLength={6}
            value={value}
            onChangeText={(t) => setValue(t.replace(/\D/g, ''))}
            hint="Ask the receiver for it; don't read it out to them."
          />
          <Button title="Handed over" icon="checkmark" disabled={value.length !== 6} loading={busy} onPress={() => void act(`/admin/parcels/${p.id}/collect`, { code: value })} />
          <Button title="Not now" variant="secondary" onPress={() => setForm(null)} />
        </Card>
      )}
      {form === 'cancel' && (
        <Card>
          <Field label="Why is it cancelled?" value={value} onChangeText={setValue} />
          {p.paid_at && <Muted>Give the fee back to the sender yourself: FarePay does not refund parcel fees.</Muted>}
          <Button title="Cancel parcel" variant="danger" disabled={value.trim().length < 3} loading={busy} onPress={() => void act(`/admin/parcels/${p.id}/cancel`, { reason: value.trim() })} />
          <Button title="Not now" variant="secondary" onPress={() => setForm(null)} />
        </Card>
      )}
      {!form && (
        <>
          {p.status === 'awaiting_payment' && (
            <>
              <Button title="Send PIN prompt again" icon="phone-portrait-outline" disabled={waiting} loading={busy} onPress={() => void act(`/admin/parcels/${p.id}/prompt`)} />
              <Button
                title="Paid in cash"
                variant="secondary"
                onPress={() =>
                  Alert.alert(`Record ${kes(p.fee)} paid in cash?`, 'Only once you have the cash.', [
                    { text: 'Not yet', style: 'cancel' },
                    { text: 'Paid in cash', onPress: () => void act(`/admin/parcels/${p.id}/payment`, { method: 'cash' }) },
                  ])
                }
              />
              <Button title="Paid by M-Pesa code" variant="secondary" onPress={() => open('code')} />
            </>
          )}
          {['received', 'on_the_way', 'arrived'].includes(p.status) && <Button title="Hand over to the receiver" icon="person-outline" onPress={() => open('collect')} />}
          {['awaiting_payment', 'received'].includes(p.status) && <Button title="Cancel parcel" variant="danger" onPress={() => open('cancel')} />}
        </>
      )}
    </Screen>
  );
}
