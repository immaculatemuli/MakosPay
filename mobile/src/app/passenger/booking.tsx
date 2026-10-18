import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { CarMap } from '@/components/CarMap';
import { Button, Card, colors, ErrorBox, KeyValue, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, displayPhone, kes, time } from '@/lib/format';
import { t, useT } from '@/lib/i18n';
import type { SeatBooking } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const TITLE: Record<SeatBooking['status'], string> = {
  paying: 'Waiting for M-Pesa…',
  queued: 'Seat booked',
  assigned: 'Your car is coming',
  boarded: 'On board',
  cancelled: 'Cancelled',
  failed: 'Not paid',
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** What to tell the passenger now: pay, their place in the queue, which car to board, or what happened. */
function line(b: SeatBooking) {
  if (b.status === 'paying') return t('Enter your M-Pesa PIN on your phone to finish booking.');
  if (b.status === 'failed') return `${b.reason || t('M-Pesa did not complete the payment')}. ${t('No money was taken.')}`;
  if (b.status === 'cancelled') {
    const where = b.refund_to === 'wallet' ? t('{amount} is back in your FarePay wallet.', { amount: kes(b.amount) }) : t('{amount} is being sent back to your M-Pesa.', { amount: kes(b.amount) });
    return `${b.reason ? `${b.reason}. ` : ''}${where}`;
  }
  if (b.status === 'boarded') return t('You’re on board {plate}. Have a good trip to {stop}.', { plate: b.car?.plate ?? '', stop: b.stop_name });
  if (b.status === 'assigned' && b.car) {
    if (b.pickup.at_stage) return t('Board {plate} now at {place}. Show this code when you get on.', { plate: b.car.plate, place: b.pickup.name });
    if (b.car.status === 'departed') return t('{plate} has left {origin} and is coming to pick you at {place}. Be ready with this code.', { plate: b.car.plate, origin: b.route.origin, place: b.pickup.name });
    return t('{plate} will pick you at {place}. We’ll tell you when it leaves {origin}.', { plate: b.car.plate, place: b.pickup.name, origin: b.route.origin });
  }
  if (b.pickup.at_stage) {
    return b.place_in_queue === 0
      ? t('You’re next in the queue at {place}. The next car to arrive is yours.', { place: b.pickup.name })
      : t('You’re {nth} in the queue at {place}. We’ll tell you which car to board.', { nth: ordinal((b.place_in_queue ?? 0) + 1), place: b.pickup.name });
  }
  return t('Wait at {place}. We’ll tell you which car is coming for you.', { place: b.pickup.name });
}

/** One seat booking (?id=): its code, the queue or its car, calling the crew, "I'm here", and cancelling. */
export default function BookingScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useApi<SeatBooking>(`/passenger/seats/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const b = booking.data;

  // Keep it fresh while something can still change (every 3 s while paying, else every 10 s).
  const { reload } = booking;
  const waiting = b && ['paying', 'queued', 'assigned'].includes(b.status);
  const paying = b?.status === 'paying';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), paying ? 3000 : 10000);
    return () => clearInterval(timer);
  }, [waiting, paying, reload]);

  if (booking.loading && !b) return <Loading />;
  if (!b) return <Screen><ErrorBox message={booking.error ?? t('Booking not found')} onRetry={booking.reload} /></Screen>;

  const act = async (what: 'here' | 'cancel') => {
    setBusy(what);
    setError(null);
    try {
      booking.setData(await api<SeatBooking>(`/passenger/seats/${b.id}/${what}`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () =>
    Alert.alert(
      t('Cancel this booking?'),
      b.pay_with === 'wallet'
        ? t('{amount} goes back to your FarePay wallet.', { amount: kes(b.amount) })
        : t('{amount} goes back to your M-Pesa.', { amount: kes(b.amount) }),
      [
        { text: t('Keep it'), style: 'cancel' },
        { text: t('Cancel booking'), style: 'destructive', onPress: () => void act('cancel') },
      ],
    );

  const good = ['queued', 'assigned', 'boarded'].includes(b.status);
  // The car's crew to call: the conductor on a bus, else the driver.
  const crew = b.status === 'assigned' && b.car ? (b.car.conductor ?? b.car.driver) : null;
  return (
    <Screen refreshing={booking.refreshing} onRefresh={booking.refresh}>
      <Card>
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ fontWeight: '800', fontSize: 18, color: good ? colors.primaryDark : b.status === 'paying' ? colors.warning : colors.danger }}>
            {t(TITLE[b.status])}
          </Text>
          <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 6, color: colors.text, marginVertical: 4 }}>{b.code}</Text>
          {b.car && <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text }}>{b.car.plate}</Text>}
          {b.car?.description && <Muted>{b.car.description}</Muted>}
        </View>
      </Card>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginVertical: 8 }}>{line(b)}</Text>

      {b.status === 'assigned' && b.car?.expected_at_pickup && (
        <Muted center>{t('It usually reaches {place} about {time}.', { place: b.pickup.name, time: time(b.car.expected_at_pickup) })}</Muted>
      )}
      {b.status === 'assigned' && b.car?.location && (
        <>
          <CarMap cars={[{ id: b.id, lat: b.car.location.lat, lng: b.car.location.lng, label: b.car.plate }]} />
          <Muted center>{t('Position at {time}', { time: time(b.car.location.at) })}</Muted>
        </>
      )}
      {crew && (
        <Button
          title={t('Call {who} ({name})', { who: b.car?.conductor ? t('the conductor') : t('the driver'), name: crew.name })}
          icon="call-outline"
          onPress={() => void Linking.openURL(`tel:${displayPhone(crew.phone)}`)}
        />
      )}
      {(b.status === 'queued' || b.status === 'assigned') && !b.passenger_here_at && (
        <Button title={t('I’m at the pickup point')} variant="secondary" icon="location-outline" loading={busy === 'here'} onPress={() => void act('here')} />
      )}
      {b.passenger_here_at && b.status !== 'boarded' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginVertical: 4 }}>
          <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
          <Muted>{t('We told them you’re waiting.')}</Muted>
        </View>
      )}

      <Card>
        <KeyValue label={t('Route')} value={b.route.name} />
        <KeyValue label={t('Pickup')} value={b.pickup.name} />
        <KeyValue label={t('Getting off at')} value={b.stop_name} />
        <KeyValue label={t('Seats')} value={String(b.seats)} />
        <KeyValue
          label={t('Paid')}
          value={b.free_ride ? t('{amount} · free, paid by the SACCO', { amount: kes(b.amount) }) : `${kes(b.amount)} · ${b.pay_with === 'wallet' ? t('Wallet') : 'M-Pesa'}`}
        />
        <KeyValue label={t('Booked')} value={dateTime(b.booked_at)} />
      </Card>

      {error && <ErrorBox message={error} />}
      {b.can_cancel && (
        <Button
          title={b.free_ride ? t('Cancel (keep my free ride)') : b.pay_with === 'wallet' ? t('Cancel booking (refund to wallet)') : t('Cancel booking (refund to M-Pesa)')}
          variant="danger"
          loading={busy === 'cancel'}
          onPress={cancel}
        />
      )}
      <Button title={t('Book another seat')} variant="secondary" onPress={() => router.replace('/passenger/book')} />
    </Screen>
  );
}
