import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes, time } from '@/lib/format';
import type { CrewLoad, CrewBooking } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const STATUS: Record<CrewBooking['status'], { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  confirmed: { text: 'Paid', tone: 'success' },
  paying: { text: 'Paying…', tone: 'warning' },
  boarded: { text: 'On board', tone: 'neutral' },
};

/**
 * Seat bookings for the car at the stage. The crew start loading (passengers can then book seats on the website),
 * tick booked passengers in as they board, and mark the car as left.
 */
export function CrewBookings() {
  const load = useApi<CrewLoad>('/crew/loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New bookings arrive while the car loads: look again every 15 seconds.
  const { reload } = load;
  const loadingNow = Boolean(load.data?.loading);
  useEffect(() => {
    if (!loadingNow) return;
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [loadingNow, reload]);

  if (load.loading && !load.data) return <Loading />;
  const d = load.data;

  const act = async (key: string, path: string) => {
    setBusy(key);
    setError(null);
    try {
      load.setData(await api<CrewLoad>(path, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const depart = () =>
    Alert.alert('Has the car left the stage?', 'Passengers can no longer book seats on it.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Yes, it has left', onPress: () => void act('depart', '/crew/loading/depart') },
    ]);

  return (
    <Screen refreshing={load.refreshing} onRefresh={load.refresh}>
      {(load.error || error) && <ErrorBox message={(error ?? load.error)!} onRetry={error ? undefined : load.reload} />}
      {d && !d.loading && (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Not taking bookings</Text>
          <Muted>When the car is at the stage, start loading: passengers can then book and pay for seats on it on the website.</Muted>
          <View style={{ height: 8 }} />
          <Button title={`Start loading (${d.vehicle_seats} seats)`} icon="people-outline" onPress={() => void act('start', '/crew/loading/start')} loading={busy === 'start'} />
        </Card>
      )}
      {d?.loading && (
        <>
          <Card>
            <Text style={{ color: colors.muted }}>Loading since {time(d.loading.started_at)}</Text>
            <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text }}>
              {d.loading.seats_booked} of {d.loading.seats} seats booked
            </Text>
            <Text style={{ color: d.loading.seats_left ? colors.primary : colors.danger, fontWeight: '700' }}>
              {d.loading.seats_left ? `${d.loading.seats_left} left` : 'Full'}
            </Text>
            <View style={{ height: 8 }} />
            <Button title="The car has left" variant="secondary" icon="bus-outline" onPress={depart} loading={busy === 'depart'} />
          </Card>
          <SectionTitle>Booked passengers</SectionTitle>
          {d.bookings?.length === 0 && <Empty text="No bookings yet. They appear here as passengers book." />}
          {d.bookings?.map((b) => (
            <Card key={b.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 2, color: colors.text }}>{b.code}</Text>
                <Badge text={STATUS[b.status].text} tone={STATUS[b.status].tone} />
              </View>
              <Text style={{ color: colors.text, fontWeight: '600', marginTop: 4 }}>
                {b.seats} seat{b.seats === 1 ? '' : 's'} · to {b.stop_name} · {kes(b.amount)}
              </Text>
              <Muted>
                {b.passenger_name} · {b.passenger_phone} · booked {time(b.booked_at)}
              </Muted>
              {b.status === 'confirmed' && (
                <Button title="On board" icon="checkmark" onPress={() => void act(`board-${b.id}`, `/crew/bookings/${b.id}/board`)} loading={busy === `board-${b.id}`} />
              )}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
