import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes, time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { CrewBooking, CrewLoad } from '@/lib/types';
import { SeatPickups } from './SeatPickups';
import { useApi } from '@/lib/useApi';

const STATUS: Record<CrewBooking['status'], { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  confirmed: { text: 'Paid', tone: 'success' },
  paying: { text: 'Paying…', tone: 'warning' },
  boarded: { text: 'On board', tone: 'neutral' },
};

/**
 * Seat bookings and the trip. At the stage the crew start loading (passengers can then book seats on the website),
 * tick booked passengers in, and mark the car as left. On the road they tick each stop as the car reaches it
 * (passengers who booked see where the car is) and finish the trip.
 */
export function CrewBookings() {
  const { t } = useT();
  const load = useApi<CrewLoad>('/crew/loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New bookings arrive while the car loads or is on the road: look again every 15 seconds.
  const { reload } = load;
  const loadingNow = Boolean(load.data?.loading || load.data?.on_road);
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
    Alert.alert(t('Has the car left the stage?'), t('Passengers can no longer book seats on it.'), [
      { text: t('Not yet'), style: 'cancel' },
      { text: t('Yes, it has left'), onPress: () => void act('depart', '/crew/loading/depart') },
    ]);
  const start = () =>
    d?.on_road
      ? Alert.alert(t('Start loading again?'), t('This ends the trip on the road.'), [
          { text: t('Not yet'), style: 'cancel' },
          { text: t('Start loading'), onPress: () => void act('start', '/crew/loading/start') },
        ])
      : void act('start', '/crew/loading/start');
  const finish = () =>
    Alert.alert(t('Is the trip finished?'), t('Passengers who booked see that the car has finished its trip.'), [
      { text: t('Not yet'), style: 'cancel' },
      { text: t('Yes, finished'), onPress: () => void act('finish', '/crew/road/finish') },
    ]);

  const bookingCard = (b: CrewBooking) => (
    <Card key={b.id}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 2, color: colors.text }}>{b.code}</Text>
        <Badge text={t(STATUS[b.status].text)} tone={STATUS[b.status].tone} />
      </View>
      <Text style={{ color: colors.text, fontWeight: '600', marginTop: 4 }}>
        {t(b.seats === 1 ? '{n} seat' : '{n} seats', { n: b.seats })} · {t('to {place}', { place: b.stop_name })} · {kes(b.amount)}
      </Text>
      <Muted>
        {b.passenger_name} · {b.passenger_phone} · {t('booked {time}', { time: time(b.booked_at) })}
      </Muted>
      {b.status === 'confirmed' && (
        <Button title={t('On board')} icon="checkmark" onPress={() => void act(`board-${b.id}`, `/crew/bookings/${b.id}/board`)} loading={busy === `board-${b.id}`} />
      )}
    </Card>
  );

  return (
    <Screen refreshing={load.refreshing} onRefresh={load.refresh}>
      {(load.error || error) && <ErrorBox message={(error ?? load.error)!} onRetry={error ? undefined : load.reload} />}
      <SeatPickups />

      {d?.on_road && (
        <>
          <SectionTitle>{t('On the road')}</SectionTitle>
          <Card>
            <Text style={{ color: colors.muted }}>{t('Left the stage at {time}', { time: time(d.on_road.departed_at) })}</Text>
            <Muted>{t('Tap each stop as you reach it. Passengers who booked see where the car is.')}</Muted>
            {d.on_road.stops.map((s) => (
              <Pressable
                key={s.id}
                disabled={Boolean(s.reached_at) || busy !== null}
                onPress={() => void act(`stop-${s.id}`, `/crew/road/stops/${s.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  opacity: pressed ? 0.6 : 1,
                })}
                accessibilityLabel={s.reached_at ? t('{stop}, reached at {time}', { stop: s.name, time: time(s.reached_at) }) : t('Mark {stop} as reached', { stop: s.name })}
              >
                <Ionicons name={s.reached_at ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={s.reached_at ? colors.primary : colors.muted} />
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.text }}>{s.name}</Text>
                <Text style={{ color: s.reached_at ? colors.muted : colors.primary, fontWeight: '600' }}>
                  {busy === `stop-${s.id}` ? '…' : s.reached_at ? time(s.reached_at) : t('Reached')}
                </Text>
              </Pressable>
            ))}
            <Button title={t('Trip finished')} variant="secondary" icon="flag-outline" onPress={finish} loading={busy === 'finish'} />
          </Card>
          {d.on_road.bookings.length > 0 && <SectionTitle>{t('Booked passengers on this trip')}</SectionTitle>}
          {d.on_road.bookings.map(bookingCard)}
        </>
      )}

      {d && !d.loading && (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{t('Not taking bookings')}</Text>
          <Muted>{t('When the car is at the stage, start loading: passengers can then book and pay for seats on it on the website.')}</Muted>
          <View style={{ height: 8 }} />
          <Button title={t('Start loading ({n} seats)', { n: d.vehicle_seats })} icon="people-outline" onPress={start} loading={busy === 'start'} />
        </Card>
      )}
      {d?.loading && (
        <>
          <SectionTitle>{t('At the stage')}</SectionTitle>
          <Card>
            <Text style={{ color: colors.muted }}>{t('Loading since {time}', { time: time(d.loading.started_at) })}</Text>
            <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text }}>
              {t('{booked} of {seats} seats booked', { booked: d.loading.seats_booked, seats: d.loading.seats })}
            </Text>
            <Text style={{ color: d.loading.seats_left ? colors.primary : colors.danger, fontWeight: '700' }}>
              {d.loading.seats_left ? t('{n} left', { n: d.loading.seats_left }) : t('Full')}
            </Text>
            <View style={{ height: 8 }} />
            <Button title={t('The car has left')} variant="secondary" icon="bus-outline" onPress={depart} loading={busy === 'depart'} />
          </Card>
          <SectionTitle>{t('Booked passengers')}</SectionTitle>
          {d.bookings.length === 0 && <Empty text={t('No bookings yet. They appear here as passengers book.')} />}
          {d.bookings.map(bookingCard)}
        </>
      )}
    </Screen>
  );
}
