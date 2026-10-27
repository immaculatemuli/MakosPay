import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { CarMap } from '@/components/CarMap';
import { RideStops, SeatJourney } from '@/components/SeatJourney';
import { Button, Card, colors, ErrorBox, KeyValue, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, dayTime, displayPhone, kes, time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { SeatBooking } from '@/lib/types';
import { seatLine, seatTitle } from '@/lib/seatText';
import { useApi } from '@/lib/useApi';

/** One seat booking (?id=): its code, the journey so far (queue, car, ride), calling the crew, "I'm here", and cancelling. */
export default function BookingScreen() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const booking = useApi<SeatBooking>(`/passenger/seats/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const b = booking.data;

  // Keep it fresh while something can still change: every 3 s while paying, 10 s waiting for the car, 20 s on the ride.
  const { reload } = booking;
  const riding = b?.status === 'boarded' && !b.car?.reached_my_stop;
  const every = b?.status === 'paying' ? 3000 : b && ['queued', 'assigned'].includes(b.status) ? 10000 : riding ? 20000 : null;
  useEffect(() => {
    if (!every) return;
    const timer = setInterval(() => void reload(), every);
    return () => clearInterval(timer);
  }, [every, reload]);

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
            {t(seatTitle(b))}
          </Text>
          {/* Shown at boarding: the marshal or conductor scans it (or reads the code below). */}
          {(b.status === 'queued' || b.status === 'assigned') && (
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 12, marginVertical: 8 }}>
              <QRCode value={`FAREPAY-SEAT:${b.code}`} size={200} />
            </View>
          )}
          <Text style={{ fontSize: 40, fontWeight: '800', letterSpacing: 6, color: colors.text, marginVertical: 4 }}>{b.code}</Text>
          {(b.status === 'queued' || b.status === 'assigned') && <Muted center>{t('Show this when you board: they scan it.')}</Muted>}
          {b.car && <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text }}>{b.car.plate}</Text>}
          {b.car?.description && <Muted>{b.car.description}</Muted>}
        </View>
      </Card>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center', marginVertical: 8 }}>{seatLine(b)}</Text>
      {good && <SeatJourney b={b} onDue={() => void reload()} />}
      {!!every && every > 3000 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
          <Muted>{t('Live: this page updates by itself')}</Muted>
        </View>
      )}

      {b.status === 'assigned' && b.car?.expected_at_pickup && (
        <Muted center>{t('It usually reaches {place} about {time}.', { place: b.pickup.name, time: time(b.car.expected_at_pickup) })}</Muted>
      )}
      {b.status === 'assigned' && b.car?.location && (
        <>
          <CarMap cars={[{ id: b.id, lat: b.car.location.lat, lng: b.car.location.lng, label: b.car.plate }]} />
          <Muted center>{t('Position at {time}', { time: time(b.car.location.at) })}</Muted>
        </>
      )}
      <RideStops b={b} />
      {crew && (
        <Button
          title={t('Call {who} ({name})', { who: b.car?.conductor ? t('the conductor') : t('the driver'), name: crew.name })}
          icon="call-outline"
          onPress={() => void Linking.openURL(`tel:${displayPhone(crew.phone)}`)}
        />
      )}
      {(b.status === 'queued' || b.status === 'assigned') && !b.later && !b.passenger_here_at && (
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
        {b.ready_at && <KeyValue label={t('Ready from')} value={dayTime(b.ready_at)} />}
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
      {b.status === 'boarded' && b.car?.reached_my_stop && (
        <Button title={t('Report a problem')} variant="secondary" icon="chatbox-ellipses-outline" onPress={() => router.push('/passenger/report')} />
      )}
      <Button title={t('Book another seat')} variant="secondary" onPress={() => router.replace('/passenger/book')} />
    </Screen>
  );
}
