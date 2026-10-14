import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, colors, ErrorBox, Field, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, time } from '@/lib/format';
import type { ParcelTracking } from '@/lib/types';

const STATUS: Record<ParcelTracking['status'], string> = {
  awaiting_payment: 'Waiting for payment at the office',
  received: 'At the office, waiting for a car',
  on_the_way: 'On the way',
  arrived: 'Arrived: ready to collect',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

function line(p: ParcelTracking) {
  if (p.status === 'on_the_way') return `On ${p.plate}${p.expected_at ? `, expected at ${p.to} about ${time(p.expected_at)}` : ''}.`;
  if (p.status === 'arrived') return `It is at ${p.to}. The receiver collects it with the 6-digit collection code.`;
  if (p.status === 'received') return `It goes on the next car to ${p.to}.`;
  if (p.status === 'collected') return 'The receiver has collected this parcel.';
  if (p.status === 'cancelled') return 'This parcel was cancelled at the office.';
  return 'The sender has not paid the fee yet.';
}

/** Track a parcel sent with the SACCO by its 8-character tracking code (from the parcel receipt). */
export default function TrackParcel() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parcel, setParcel] = useState<ParcelTracking | null>(null);

  const track = async () => {
    setBusy(true);
    setError(null);
    try {
      setParcel(await api<ParcelTracking>(`/book-api/parcels/${encodeURIComponent(code.trim().toUpperCase())}`));
    } catch (err) {
      setParcel(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Muted>Enter the tracking code from the parcel receipt. The receiver collects the parcel with the 6-digit collection code the sender gives them.</Muted>
      <Field
        label="Tracking code"
        placeholder="8 letters and numbers"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        onSubmitEditing={track}
        style={{ fontSize: 22, letterSpacing: 3, textAlign: 'center' }}
      />
      <Button title="Track" icon="search" loading={busy} disabled={code.trim().length < 6} onPress={() => void track()} />
      {error && <ErrorBox message={error} />}
      {parcel && (
        <>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', fontSize: 18, color: parcel.status === 'cancelled' ? colors.danger : colors.primaryDark }}>{STATUS[parcel.status]}</Text>
              <Text style={{ fontSize: 30, fontWeight: '800', letterSpacing: 4, color: colors.text, marginVertical: 4 }}>{parcel.tracking_code}</Text>
              <Text style={{ color: colors.text }}>
                {parcel.from} → {parcel.to} ({parcel.route})
              </Text>
              <Muted>
                From {parcel.sender} to {parcel.receiver}
              </Muted>
            </View>
          </Card>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginVertical: 8 }}>{line(parcel)}</Text>
          <SectionTitle>History</SectionTitle>
          <Card>
            {parcel.events.map((e) => (
              <View key={e.what + e.at} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                <Text style={{ flex: 1, fontWeight: '600', color: colors.text }}>{e.what}</Text>
                <Text style={{ color: colors.muted }}>{dateTime(e.at)}</Text>
              </View>
            ))}
          </Card>
          <Button title="Check again" variant="secondary" icon="refresh" loading={busy} onPress={() => void track()} />
        </>
      )}
    </Screen>
  );
}
