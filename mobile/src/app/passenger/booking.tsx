import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, colors, ErrorBox, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes, time } from '@/lib/format';
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
  if (b.status === 'paying') return 'Enter your M-Pesa PIN on your phone to finish booking.';
  if (b.status === 'failed') return `${b.reason || 'M-Pesa did not complete the payment'}. No money was taken, and no seat is held.`;
  if (b.status === 'paid_late') return 'M-Pesa confirmed your payment too late for this car, so the money is in your wallet.';
  if (b.status === 'cancelled') return 'This booking was cancelled and the money returned to your wallet.';
  if (c.status === 'departed') {
    if (c.finished_at) return 'This trip has finished.';
    if (c.reached_my_stop) return `Your car reached ${b.stop_name} at ${time(c.stops.find((s) => s.mine)!.reached_at!)}.`;
    const passed = c.stops.filter((s) => s.reached_at).pop();
    return [
      `Left ${b.route.origin} at ${time(c.departed_at!)}.`,
      passed ? `Passed ${passed.name} at ${time(passed.reached_at!)}.` : '',
      c.expected_at_my_stop ? `Expected at ${b.stop_name} about ${time(c.expected_at_my_stop)}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (b.status === 'boarded') return `You're on board. The car leaves ${b.route.origin} when it is ready.`;
  if (c.cars_ahead > 0) return `Your car is loading at ${b.route.origin}. ${c.cars_ahead} car${c.cars_ahead === 1 ? '' : 's'} ahead of it will leave first.`;
  return `Your car is loading at ${b.route.origin} now. Go to the stage and show this code to the conductor.`;
}

/** One booking (?id=): its code, the car and where it is; cancel while the car is still at the stage. */
export default function BookingScreen() {
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
  if (!b) return <Screen><ErrorBox message={booking.error ?? 'Booking not found'} onRetry={booking.reload} /></Screen>;

  const cancel = () =>
    Alert.alert('Cancel this booking?', `${kes(b.amount)} goes back to your FarePay wallet.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking',
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
          <Text style={{ fontWeight: '800', fontSize: 18, color: good ? colors.primaryDark : b.status === 'paying' ? colors.warning : colors.danger }}>{TITLE[b.status]}</Text>
          <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 6, color: colors.text, marginVertical: 4 }}>{b.code}</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{b.car.plate}</Text>
          <Text style={{ color: colors.text, marginTop: 4, textAlign: 'center' }}>
            {b.route.name} to {b.stop_name} · {b.seats} seat{b.seats === 1 ? '' : 's'} · {kes(b.amount)}
          </Text>
          <Muted>Booked {dateTime(b.booked_at)}</Muted>
        </View>
      </Card>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginVertical: 8 }}>{line(b)}</Text>

      {b.car.status === 'departed' && good && (
        <>
          <SectionTitle>Where the car is</SectionTitle>
          <Card>
            {b.car.stops.map((s) => (
              <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Ionicons name={s.reached_at ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={s.reached_at ? colors.primary : colors.muted} />
                <Text style={{ flex: 1, fontWeight: s.mine ? '800' : '600', color: colors.text }}>
                  {s.name}
                  {s.mine ? ' (your stop)' : ''}
                </Text>
                <Text style={{ color: colors.muted }}>
                  {s.reached_at ? time(s.reached_at) : s.mine && b.car.expected_at_my_stop ? `about ${time(b.car.expected_at_my_stop)}` : '—'}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {error && <ErrorBox message={error} />}
      {b.can_cancel && <Button title="Cancel booking (refund to wallet)" variant="danger" loading={busy} onPress={cancel} />}
      <Button title="Book another seat" variant="secondary" onPress={() => router.replace('/passenger/book')} />
    </Screen>
  );
}
