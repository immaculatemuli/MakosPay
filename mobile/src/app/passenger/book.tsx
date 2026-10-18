import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { PassengerSummary, SeatBooking, SeatRoutes } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const MAX_SEATS = 10;

/** What a seat booking is doing now, in a few words. */
const SEAT_WORD: Record<SeatBooking['status'], string> = {
  paying: 'Paying…',
  queued: 'In the queue',
  assigned: 'Car coming',
  boarded: 'On board',
  cancelled: 'Cancelled',
  failed: 'Not paid',
};

/**
 * Book a seat from anywhere: the route, where to be picked (the stage, or a stop on the road), the drop-off and the
 * seats; paid from the wallet or by M-Pesa. The booking joins the queue and its car is shown when one takes it.
 */
export default function BookSeat() {
  const { t } = useT();
  const data = useApi<SeatRoutes>('/passenger/seat-routes');
  const mine = useApi<SeatBooking[]>('/passenger/seats');
  const wallet = useApi<{ balance: number }>('/passenger/wallet');
  const summary = useApi<PassengerSummary>('/passenger/summary');
  const [routeId, setRouteId] = useState<number | null>(null);
  // undefined = not chosen yet; null = at the stage.
  const [pickupId, setPickupId] = useState<number | null | undefined>(undefined);
  const [stopId, setStopId] = useState<number | null>(null);
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per confirmation: a retry after a network failure returns the same booking instead of charging again.
  const idempotencyKey = useRef(Crypto.randomUUID());

  if ((data.loading && !data.data) || (mine.loading && !mine.data)) return <Loading />;
  const route = data.data?.routes.find((r) => r.id === routeId) ?? null;
  const pickupStop = route?.stops.find((s) => s.id === pickupId) ?? null;
  const dropOffs = route ? route.stops.filter((s) => !pickupStop || s.position > pickupStop.position) : [];
  const stop = dropOffs.find((s) => s.id === stopId) ?? null;
  const total = stop ? stop.fare * seats : 0;
  const balance = wallet.data?.balance ?? 0;
  // Loyalty: a one-seat booking can be the passenger's free ride.
  const freeNow = Boolean(summary.data?.free_ride.next_is_free) && seats === 1;
  const open = (mine.data ?? []).filter((b) => ['paying', 'queued', 'assigned'].includes(b.status));
  const earlier = (mine.data ?? []).filter((b) => !open.includes(b));

  const refresh = () => {
    data.refresh();
    mine.refresh();
    wallet.refresh();
  };

  const book = async (payWith: 'wallet' | 'mpesa') => {
    if (!route || !stop || pickupId === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api<SeatBooking>('/passenger/seats', {
        method: 'POST',
        body: { route_id: route.id, pickup_stop_id: pickupId, stop_id: stop.id, seats, expected_fare: stop.fare, idempotency_key: idempotencyKey.current, pay_with: payWith },
      });
      idempotencyKey.current = Crypto.randomUUID();
      router.push({ pathname: '/passenger/booking', params: { id: String(b.id) } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FARE_CHANGED') {
        idempotencyKey.current = Crypto.randomUUID();
        await data.reload();
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const bookingRow = (b: SeatBooking) => (
    <ListRow
      key={b.id}
      icon={open.includes(b) ? 'ticket-outline' : 'time-outline'}
      title={`${b.code}${b.car ? ` · ${b.car.plate}` : ''}`}
      subtitle={`${b.route.name} · ${b.pickup.name} → ${b.stop_name}`}
      right={t(SEAT_WORD[b.status])}
      onPress={() => router.push({ pathname: '/passenger/booking', params: { id: String(b.id) } })}
    />
  );

  return (
    <Screen refreshing={data.refreshing || mine.refreshing} onRefresh={refresh}>
      {open.length > 0 && (
        <>
          <SectionTitle>{t('Your bookings')}</SectionTitle>
          <List>{open.map(bookingRow)}</List>
        </>
      )}

      <SectionTitle>{t('Book a seat')}</SectionTitle>
      <Muted>{t('Book from anywhere: wait at the stage, or at a stop on the road to be picked. We tell you which car is yours as soon as it is there.')}</Muted>
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      {data.data && !data.data.open && <Notice>{t('Seat booking is closed for today. It opens again at {time}.', { time: data.data.opens_at })}</Notice>}
      {data.data?.routes.length === 0 && <Empty text={t('No routes are open for booking yet.')} />}

      {data.data?.open && !!data.data.routes.length && (
        <Chips
          label={t('Your route')}
          options={data.data.routes.map((r) => ({ value: r.id as number | null, label: r.name }))}
          value={routeId}
          onChange={(v) => {
            setRouteId(v);
            setPickupId(undefined);
            setStopId(null);
            setError(null);
          }}
        />
      )}

      {route && (
        <>
          <Muted>
            {route.seats_waiting
              ? t('{n} seats already booked in the queue at {place}.', { n: route.seats_waiting, place: route.origin })
              : t('No queue at {place} right now.', { place: route.origin })}
          </Muted>
          <Chips
            label={t('Where should we pick you?')}
            options={[
              { value: null as number | null, label: t('{place} stage', { place: route.origin }) },
              ...route.stops.slice(0, -1).map((s) => ({ value: s.id as number | null, label: s.name })),
            ]}
            value={pickupId === undefined ? -1 : pickupId}
            onChange={(v) => {
              setPickupId(v);
              const chosen = route.stops.find((s) => s.id === v);
              const current = route.stops.find((s) => s.id === stopId);
              if (chosen && current && current.position <= chosen.position) setStopId(null);
            }}
          />
        </>
      )}

      {route && pickupId !== undefined && (
        <>
          <Chips
            label={t('Where are you getting off?')}
            options={dropOffs.map((s) => ({ value: s.id as number | null, label: `${s.name} · ${kes(s.fare)}` }))}
            value={stopId}
            onChange={setStopId}
          />
          <Text style={{ fontWeight: '600', color: colors.text, marginTop: 8 }}>{t('Seats')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 }}>
            <View style={{ width: 64 }}>
              <Button title="−" variant="secondary" disabled={seats <= 1} onPress={() => setSeats(Math.max(1, seats - 1))} />
            </View>
            <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, minWidth: 32, textAlign: 'center' }}>{seats}</Text>
            <View style={{ width: 64 }}>
              <Button title="+" variant="secondary" disabled={seats >= MAX_SEATS} onPress={() => setSeats(Math.min(MAX_SEATS, seats + 1))} />
            </View>
          </View>
        </>
      )}

      {route && stop && pickupId !== undefined && (
        <>
          <Card>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>
                {t(seats === 1 ? '{n} seat' : '{n} seats', { n: seats })} · {pickupStop ? pickupStop.name : t('{place} stage', { place: route.origin })} → {stop.name}
              </Text>
              <Text style={{ fontSize: 36, fontWeight: '800', color: colors.text }}>{kes(total)}</Text>
              <Muted>{t('Wallet balance {amount}', { amount: kes(balance) })}</Muted>
            </View>
          </Card>
          {pickupStop && <Muted>{t('The fare is the same as from the stage, wherever you are picked.')}</Muted>}
          {error && <ErrorBox message={error} />}
          {freeNow && <Notice tone="success">{t('This booking is your free ride: nothing is charged.')}</Notice>}
          {freeNow && <Button title={t('Book my free ride')} icon="gift-outline" loading={busy} onPress={() => void book('wallet')} />}
          {!freeNow && (
          <>
          <Button title={t('Pay {amount} from wallet', { amount: kes(total) })} icon="wallet-outline" disabled={balance < total} loading={busy} onPress={() => void book('wallet')} />
          <Button title={t('Pay {amount} with M-Pesa', { amount: kes(total) })} variant="secondary" icon="phone-portrait-outline" disabled={busy} onPress={() => void book('mpesa')} />
          {balance < total && <Muted center>{t('Your wallet is short by {amount}: pay with M-Pesa, or add money first.', { amount: kes(total - balance) })}</Muted>}
          </>
          )}
          <Muted center>{t('If no car takes you today, the money goes back the way you paid.')}</Muted>
        </>
      )}

      {earlier.length > 0 && (
        <>
          <SectionTitle>{t('Earlier this week')}</SectionTitle>
          <List>{earlier.map(bookingRow)}</List>
        </>
      )}
    </Screen>
  );
}
