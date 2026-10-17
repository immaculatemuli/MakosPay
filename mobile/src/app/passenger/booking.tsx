import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, colors, ErrorBox, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes, time } from '@/lib/format';
import { t, useT } from '@/lib/i18n';
import type { Booking } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const TITLE: Record<Booking['status'], string> = {
  paying: 'Waiting for M-Pesa…',
  confirmed: 'Seat booked',
  boarded: 'On board',
  departed: 'Car has left',
  cancelled: 'Cancelled',
  failed: 'Not paid',
  paid_late: 'Paid too late',
};

/** What to tell the passenger now: pay, go to the stage, where the car is, or what happened. */
function line(b: Booking) {
  const c = b.car;
  if (b.status === 'paying') return t('Enter your M-Pesa PIN on your phone to finish booking.');
  if (b.status === 'failed') return `${b.reason || t('M-Pesa did not complete the payment')}. ${t('No money was taken, and no seat is held.')}`;
  if (b.status === 'paid_late') return t('M-Pesa confirmed your payment too late for this car, so the money is in your wallet.');
  if (b.status === 'cancelled') return t('This booking was cancelled and the money returned to your wallet.');
  if (c.status === 'departed') {
    if (c.finished_at) return t('This trip has finished.');
    if (c.reached_my_stop) return t('Your car reached {stop} at {time}.', { stop: b.stop_name, time: time(c.stops.find((s) => s.mine)!.reached_at!) });
    const passed = c.stops.filter((s) => s.reached_at).pop();
    return [
      t('Left {place} at {time}.', { place: b.route.origin, time: time(c.departed_at!) }),
      passed ? t('Passed {place} at {time}.', { place: passed.name, time: time(passed.reached_at!) }) : '',
      c.expected_at_my_stop ? t('Expected at {stop} about {time}.', { stop: b.stop_name, time: time(c.expected_at_my_stop) }) : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (b.status === 'boarded') return t('You’re on board. The car leaves {place} when it is ready.', { place: b.route.origin });
  if (c.cars_ahead > 0) {
    return t(c.cars_ahead === 1 ? 'Your car is loading at {place}. {n} car ahead of it will leave first.' : 'Your car is loading at {place}. {n} cars ahead of it will leave first.', {
      place: b.route.origin,
      n: c.cars_ahead,
    });
  }
  return t('Your car is loading at {place} now. Go to the stage and show this code to the conductor.', { place: b.route.origin });
}

/** One booking (?id=): its code, the car and where it is; cancel while the car is still at the stage. */
export default function BookingScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useApi<Booking>(`/passenger/bookings/${id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = booking.data;

  // Keep it fresh while something can still change (every 3 s while paying, else every 15 s).
  const { reload } = booking;
  const moving = b && (b.status === 'paying' || b.status === 'confirmed' || (['boarded', 'departed'].includes(b.status) && !b.car.finished_at));
  const paying = b?.status === 'paying';
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void reload(), paying ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [moving, paying, reload]);

  if (booking.loading && !b) return <Loading />;
  if (!b) return <Screen><ErrorBox message={booking.error ?? t('Booking not found')} onRetry={booking.reload} /></Screen>;

  const cancel = () =>
    Alert.alert(t('Cancel this booking?'), t('{amount} goes back to your FarePay wallet.', { amount: kes(b.amount) }), [
      { text: t('Keep it'), style: 'cancel' },
      {
        text: t('Cancel booking'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            booking.setData(await api<Booking>(`/passenger/bookings/${b.id}/cancel`, { method: 'POST' }));
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const good = ['confirmed', 'boarded', 'departed'].includes(b.status);
  return (
    <Screen refreshing={booking.refreshing} onRefresh={booking.refresh}>
      <Card>
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ fontWeight: '800', fontSize: 18, color: good ? colors.primaryDark : b.status === 'paying' ? colors.warning : colors.danger }}>{t(TITLE[b.status])}</Text>
          <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 6, color: colors.text, marginVertical: 4 }}>{b.code}</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{b.car.plate}</Text>
          <Text style={{ color: colors.text, marginTop: 4, textAlign: 'center' }}>
            {b.route.name} · {t('to {place}', { place: b.stop_name })} · {t(b.seats === 1 ? '{n} seat' : '{n} seats', { n: b.seats })} · {kes(b.amount)}
          </Text>
          <Muted>{t('Booked {when}', { when: dateTime(b.booked_at) })}</Muted>
        </View>
      </Card>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginVertical: 8 }}>{line(b)}</Text>

      {b.car.status === 'departed' && good && (
        <>
          <SectionTitle>{t('Where the car is')}</SectionTitle>
          <Card>
            {b.car.stops.map((s) => (
              <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Ionicons name={s.reached_at ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={s.reached_at ? colors.primary : colors.muted} />
                <Text style={{ flex: 1, fontWeight: s.mine ? '800' : '600', color: colors.text }}>
                  {s.name}
                  {s.mine ? ` (${t('your stop')})` : ''}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {s.reached_at ? time(s.reached_at) : s.mine && b.car.expected_at_my_stop ? t('about {time}', { time: time(b.car.expected_at_my_stop) }) : '—'}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {error && <ErrorBox message={error} />}
      {b.can_cancel && <Button title={t('Cancel booking (refund to wallet)')} variant="danger" loading={busy} onPress={cancel} />}
      <Button title={t('Book another seat')} variant="secondary" onPress={() => router.replace('/passenger/book')} />
    </Screen>
  );
}
