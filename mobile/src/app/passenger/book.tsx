import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { dateTime, kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Booking, BookingRoute } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const BOOKING_WORD: Record<Booking['status'], string> = {
  paying: 'Paying…',
  confirmed: 'Booked',
  boarded: 'On board',
  departed: 'Car has left',
  cancelled: 'Cancelled',
  failed: 'Not paid',
  paid_late: 'Paid late',
};

/**
 * Book a seat on the next car loading at the stage: choose the route, stop and seats, then pay from the wallet at
 * once or by M-Pesa PIN prompt. Recent bookings are listed at the top.
 */
export default function BookSeat() {
  const { t } = useT();
  const seatWord = (n: number) => t(n === 1 ? '{n} seat' : '{n} seats', { n });
  const routes = useApi<BookingRoute[]>('/passenger/booking-routes');
  const mine = useApi<Booking[]>('/passenger/bookings');
  const wallet = useApi<{ balance: number }>('/passenger/wallet');
  const [routeId, setRouteId] = useState<number | null>(null);
  const [pickedStopId, setPickedStopId] = useState<number | null>(null);
  const [wantedSeats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per confirmation: a retry after a network failure returns the same booking instead of charging again.
  const idempotencyKey = useRef(Crypto.randomUUID());

  const route = routes.data?.find((r) => r.id === routeId) ?? null;
  // A route with one stop needs no choosing; seats stay within what the car has left.
  const stopId = pickedStopId ?? (route?.stops.length === 1 ? route.stops[0].id : null);
  const stop = route?.stops.find((s) => s.id === stopId) ?? null;
  const maxSeats = Math.max(1, Math.min(10, route?.next_car?.seats_left ?? 10));
  const seats = Math.min(wantedSeats, maxSeats);
  const total = stop ? stop.fare * seats : 0;
  const balance = wallet.data?.balance ?? 0;

  if ((routes.loading && !routes.data) || (mine.loading && !mine.data)) return <Loading />;

  const refresh = () => {
    routes.refresh();
    mine.refresh();
    wallet.refresh();
  };

  const book = async (payWith: 'wallet' | 'mpesa') => {
    if (!route || !stop) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<Booking>('/passenger/bookings', {
        method: 'POST',
        body: { route_id: route.id, stop_id: stop.id, seats, expected_fare: stop.fare, idempotency_key: idempotencyKey.current, pay_with: payWith },
      });
      idempotencyKey.current = Crypto.randomUUID();
      router.push({ pathname: '/passenger/booking', params: { id: String(res.id) } });
    } catch (err) {
      if (err instanceof ApiError && ['FARE_CHANGED', 'NOT_ENOUGH_SEATS', 'NO_CAR_LOADING'].includes(err.code)) {
        idempotencyKey.current = Crypto.randomUUID();
        await routes.reload();
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const active = (mine.data ?? []).filter((b) => ['paying', 'confirmed', 'boarded', 'departed'].includes(b.status) && !b.car.finished_at);

  return (
    <Screen refreshing={routes.refreshing} onRefresh={refresh}>
      {active.length > 0 && (
        <>
          <SectionTitle>{t('Your bookings')}</SectionTitle>
          <List>
            {active.map((b) => (
              <ListRow
                key={b.id}
                icon="ticket-outline"
                title={`${b.code} · ${b.car.plate}`}
                subtitle={`${b.route.name} · ${t('to {place}', { place: b.stop_name })} · ${seatWord(b.seats)}`}
                right={t(BOOKING_WORD[b.status])}
                onPress={() => router.push({ pathname: '/passenger/booking', params: { id: String(b.id) } })}
              />
            ))}
          </List>
        </>
      )}

      <SectionTitle>{t('Book a seat')}</SectionTitle>
      <Muted>{t('Book and pay for a seat on the next car loading at the stage. Show your booking code to the conductor when you get on.')}</Muted>
      {routes.error && <ErrorBox message={routes.error} onRetry={routes.reload} />}
      {routes.data?.length === 0 && <Empty text={t('No routes are open for booking yet.')} />}
      {routes.data && routes.data.length > 0 && (
        <Chips
          label={t('Your route')}
          options={routes.data.map((r) => ({ value: r.id as number | null, label: r.name }))}
          value={routeId}
          onChange={(v) => {
            setRouteId(v);
            setPickedStopId(null);
            setError(null);
          }}
        />
      )}

      {route && (
        <Card>
          {route.next_car ? (
            <>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{t('{plate} is loading', { plate: route.next_car.plate })}</Text>
              <Muted>
                {t('At {place}', { place: route.origin })} · {t(route.next_car.seats_left === 1 ? '{n} seat left' : '{n} seats left', { n: route.next_car.seats_left })}
              </Muted>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{t('No car loading yet')}</Text>
              <Muted>{t('You can book as soon as a car on {route} starts loading at {place}. Pull down to check again.', { route: route.name, place: route.origin })}</Muted>
            </>
          )}
        </Card>
      )}

      {route?.next_car && (
        <>
          {route.stops.length > 1 && (
            <Chips
              label={t('Where are you getting off?')}
              options={route.stops.map((s) => ({ value: s.id as number | null, label: `${s.name} · ${kes(s.fare)}` }))}
              value={stopId}
              onChange={setPickedStopId}
            />
          )}
          <Text style={{ fontWeight: '600', color: colors.text, marginTop: 8 }}>{t('Seats')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 }}>
            <View style={{ width: 64 }}>
              <Button title="−" variant="secondary" disabled={seats <= 1} onPress={() => setSeats(Math.max(1, seats - 1))} />
            </View>
            <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, minWidth: 32, textAlign: 'center' }}>{seats}</Text>
            <View style={{ width: 64 }}>
              <Button title="+" variant="secondary" disabled={seats >= maxSeats} onPress={() => setSeats(Math.min(maxSeats, seats + 1))} />
            </View>
          </View>
          {stop && (
            <Card>
              <View style={{ alignItems: 'center' }}>
                <Text style={{ color: colors.muted }}>
                  {seatWord(seats)} · {t('to {place}', { place: stop.name })}
                </Text>
                <Text style={{ fontSize: 36, fontWeight: '800', color: colors.text }}>{kes(total)}</Text>
                <Muted>{t('Wallet balance {amount}', { amount: kes(balance) })}</Muted>
              </View>
            </Card>
          )}
          {error && <ErrorBox message={error} />}
          {stop && (
            <>
              <Button title={t('Pay {amount} from wallet', { amount: kes(total) })} icon="wallet-outline" disabled={balance < total} loading={busy} onPress={() => void book('wallet')} />
              <Button title={t('Pay {amount} with M-Pesa', { amount: kes(total) })} variant="secondary" icon="phone-portrait-outline" disabled={busy} onPress={() => void book('mpesa')} />
              {balance < total && <Muted center>{t('Your wallet is short by {amount}: pay with M-Pesa, or add money first.', { amount: kes(total - balance) })}</Muted>}
            </>
          )}
        </>
      )}

      {(mine.data ?? []).some((b) => !active.includes(b)) && (
        <>
          <SectionTitle>{t('Earlier this week')}</SectionTitle>
          <List>
            {(mine.data ?? [])
              .filter((b) => !active.includes(b))
              .map((b) => (
                <ListRow
                  key={b.id}
                  icon="time-outline"
                  title={`${b.code} · ${b.car.plate}`}
                  subtitle={dateTime(b.booked_at)}
                  right={t(BOOKING_WORD[b.status])}
                  onPress={() => router.push({ pathname: '/passenger/booking', params: { id: String(b.id) } })}
                />
              ))}
          </List>
        </>
      )}
    </Screen>
  );
}
