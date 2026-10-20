import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CarMap } from '@/components/CarMap';
import { Badge, Button, Card, Chips, colors, Empty, ErrorBox, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dayTime, displayPhone, time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { CrewContact, MarshalQueues, QueueBooking, QueueCar, RouteQueue } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const ROUTE_KEY = 'farepay.marshalRoute';
const REFRESH_EVERY_MS = 10_000;

const call = (phone: string) => void Linking.openURL(`tel:${displayPhone(phone)}`);

/**
 * The stage marshal's screen for one route: cars loading at the stage (tick passengers on, mark the car left), the
 * queue of booked passengers in order, road pickups to give to a car, and cars on the road with whom they still pick.
 */
export default function StageQueue() {
  const { t } = useT();
  const queues = useApi<MarshalQueues>('/marshal/queues');
  const [routeId, setRouteId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [giving, setGiving] = useState<number | null>(null); // road pickup being given to a car

  // The route this marshal works (remembered on the phone).
  useEffect(() => {
    SecureStore.getItemAsync(ROUTE_KEY)
      .then((saved) => saved && setRouteId(Number(saved)))
      .catch(() => {});
  }, []);
  const chooseRoute = (id: number | null) => {
    setRouteId(id);
    if (id) SecureStore.setItemAsync(ROUTE_KEY, String(id)).catch(() => {});
  };

  // New bookings and changes show on their own.
  const { reload } = queues;
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void reload(), REFRESH_EVERY_MS);
      return () => clearInterval(timer);
    }, [reload]),
  );

  if (queues.loading && !queues.data) return <Loading />;
  const routes = queues.data?.routes ?? [];
  const route: RouteQueue | undefined = routes.find((r) => r.id === routeId) ?? routes[0];

  /** Runs a marshal action; the answer is the new state of every queue. */
  const act = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    try {
      queues.setData(await api<MarshalQueues>(path, { method: 'POST', body }));
      setGiving(null);
    } catch (err) {
      Alert.alert(t('Could not do that'), errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const cancel = (b: QueueBooking) =>
    Alert.alert(t('Cancel booking {code}?', { code: b.code }), t('{name} gets their money back the way they paid.', { name: b.passenger_name }), [
      { text: t('Keep it'), style: 'cancel' },
      { text: t('Didn’t come'), style: 'destructive', onPress: () => void act(`cancel-${b.id}`, `/marshal/seats/${b.id}/cancel`, { reason: 'Did not come to the pickup' }) },
      { text: t('Passenger asked'), onPress: () => void act(`cancel-${b.id}`, `/marshal/seats/${b.id}/cancel`, { reason: 'Cancelled at the passenger’s request' }) },
    ]);

  const left = (car: QueueCar) => {
    const waiting = car.bookings.filter((b) => b.status === 'assigned' && !b.pickup_name).length;
    Alert.alert(
      t('Has {plate} left the stage?', { plate: car.plate }),
      waiting ? t('{n} booked passengers have not boarded. They go back to the front of the queue.', { n: waiting }) : undefined,
      [
        { text: t('Not yet'), style: 'cancel' },
        { text: t('Yes, it has left'), onPress: () => void act(`left-${car.vehicle_id}`, `/marshal/cars/${car.vehicle_id}/left`) },
      ],
    );
  };

  const crewButton = (car: QueueCar) => {
    const crew: CrewContact | null = car.conductor ?? car.driver;
    return crew ? (
      <Pressable onPress={() => call(crew.phone)} style={styles.callRow} accessibilityRole="button">
        <Ionicons name="call-outline" size={16} color={colors.primary} />
        <Text style={styles.callText}>
          {t('Call {who} ({name})', { who: car.conductor ? t('the conductor') : t('the driver'), name: crew.name })}
        </Text>
      </Pressable>
    ) : (
      <Muted>{t('No driver set for this car.')}</Muted>
    );
  };

  const passengerLine = (b: QueueBooking, extra?: string) => (
    <View style={{ flex: 1 }}>
      <Text style={styles.name}>
        {b.place ? `${b.place}. ` : ''}
        {b.passenger_name} · {t(b.seats === 1 ? '{n} seat' : '{n} seats', { n: b.seats })}
      </Text>
      <Text style={styles.sub}>
        {b.code} · {t('to {place}', { place: b.stop_name })}
        {extra ? ` · ${extra}` : ''}
      </Text>
      {b.passenger_here && <Badge text={t('Here')} tone="success" />}
    </View>
  );

  const loading = route?.cars.filter((c) => c.state === 'loading') ?? [];
  const onRoad = route?.cars.filter((c) => c.state === 'on_the_road') ?? [];

  return (
    <Screen refreshing={queues.refreshing} onRefresh={queues.refresh}>
      {queues.error && <ErrorBox message={queues.error} onRetry={queues.reload} />}
      {routes.length === 0 && <Empty text={t('No routes yet. Ask the SACCO office to add one.')} />}
      {routes.length > 1 && <Chips options={routes.map((r) => ({ value: r.id as number | null, label: r.name }))} value={route?.id ?? null} onChange={chooseRoute} />}
      {queues.data && !queues.data.open && <Notice>{t('Booking is closed for today. Bookings not on a car were refunded.')}</Notice>}

      {route && (
        <>
          {/* A car arrived: scan its sticker (quickest), or find it by plate. */}
          <Button
            title={t('A car has arrived: scan its sticker')}
            icon="qr-code-outline"
            onPress={() => router.push({ pathname: '/marshal/scan-car', params: { route: String(route.id), origin: route.origin } })}
          />
          <Button
            title={t('Find it by number plate')}
            variant="secondary"
            icon="search"
            onPress={() => router.push({ pathname: '/marshal/arrived', params: { route: String(route.id), origin: route.origin } })}
          />

          <SectionTitle>{t('Loading at {place}', { place: route.origin })}</SectionTitle>
          {loading.length === 0 && <Muted>{t('No car is loading. When one arrives, tap the button above.')}</Muted>}
          {loading.some((car) => car.bookings.some((b) => b.status === 'assigned' && !b.pickup_name)) && (
            <Button title={t('Scan passengers on board')} icon="scan-outline" onPress={() => router.push('/marshal/board')} />
          )}
          {loading.map((car) => (
            <Card key={car.load_id}>
              <View style={styles.carHead}>
                <Text style={styles.plate}>{car.plate}</Text>
                <Badge text={car.seats_left ? t('{n} left', { n: car.seats_left }) : t('Full')} tone={car.seats_left ? 'success' : 'warning'} />
              </View>
              <Muted>{t('Loading since {time}', { time: time(car.started_at) })}</Muted>
              {crewButton(car)}
              {car.bookings.map((b) => (
                <View key={b.id} style={styles.row}>
                  {passengerLine(b, b.pickup_name ? t('pick at {place}', { place: b.pickup_name }) : undefined)}
                  {b.status === 'boarded' ? (
                    <Ionicons name="checkmark-circle" size={28} color={colors.primary} accessibilityLabel={t('On board')} />
                  ) : !b.pickup_name ? (
                    <View style={{ width: 110 }}>
                      <Button title={t('On board')} icon="checkmark" loading={busy === `board-${b.id}`} onPress={() => void act(`board-${b.id}`, `/marshal/seats/${b.id}/board`)} />
                    </View>
                  ) : null}
                </View>
              ))}
              {car.full && <Muted>{t('Marked full: nobody else from the queue is sent to it.')}</Muted>}
              <Button
                title={car.full ? t('Not full: take passengers from the queue') : t('The car is full')}
                variant="secondary"
                icon={car.full ? 'people-outline' : 'hand-left-outline'}
                loading={busy === `full-${car.vehicle_id}`}
                onPress={() => void act(`full-${car.vehicle_id}`, `/marshal/cars/${car.vehicle_id}/full`, { full: !car.full })}
              />
              <Button title={t('The car has left')} variant="secondary" icon="arrow-forward-circle-outline" loading={busy === `left-${car.vehicle_id}`} onPress={() => left(car)} />
            </Card>
          ))}

          <SectionTitle>{t('Queue at {place}', { place: route.origin })}</SectionTitle>
          {route.stage_queue.length === 0 ? (
            <Muted>{t('Nobody is waiting.')}</Muted>
          ) : (
            <Card>
              <Muted>{t('{n} seats booked. The next car to arrive takes them in this order.', { n: route.seats_waiting })}</Muted>
              {route.stage_queue.map((b) => (
                <View key={b.id} style={styles.row}>
                  {passengerLine(b)}
                  <Pressable onPress={() => call(b.passenger_phone)} hitSlop={8} accessibilityLabel={t('Call {name}', { name: b.passenger_name })}>
                    <Ionicons name="call-outline" size={24} color={colors.primary} />
                  </Pressable>
                  <Pressable onPress={() => cancel(b)} hitSlop={8} style={{ marginLeft: 16 }} accessibilityLabel={t('Cancel booking {code}?', { code: b.code })}>
                    <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </Card>
          )}

          <SectionTitle>{t('To pick on the road')}</SectionTitle>
          {route.road_pickups.length === 0 ? (
            <Muted>{t('No road pickups waiting.')}</Muted>
          ) : (
            route.road_pickups.map((b) => {
              // Cars on this route that still have room and haven't passed the pickup point.
              const stopId = route.stops.find((s) => s.name === b.pickup_name)?.id;
              const cars = route.cars.filter((c) => c.seats_left >= b.seats && !(stopId && c.stops_reached.includes(stopId)));
              return (
                <Card key={b.id}>
                  <View style={styles.row}>
                    {passengerLine(b, t('pick at {place}', { place: b.pickup_name ?? '' }))}
                    <Pressable onPress={() => call(b.passenger_phone)} hitSlop={8} accessibilityLabel={t('Call {name}', { name: b.passenger_name })}>
                      <Ionicons name="call-outline" size={24} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={() => cancel(b)} hitSlop={8} style={{ marginLeft: 16 }}>
                      <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
                    </Pressable>
                  </View>
                  {giving === b.id ? (
                    cars.length === 0 ? (
                      <Muted>{t('No car on this route has room. Wait for the next car to arrive.')}</Muted>
                    ) : (
                      cars.map((c) => (
                        <Button
                          key={c.load_id}
                          title={`${c.plate} · ${c.state === 'loading' ? t('at the stage') : t('on the road')} · ${t('{n} left', { n: c.seats_left })}`}
                          variant="secondary"
                          loading={busy === `give-${b.id}-${c.load_id}`}
                          onPress={() => void act(`give-${b.id}-${c.load_id}`, `/marshal/seats/${b.id}/assign`, { load_id: c.load_id })}
                        />
                      ))
                    )
                  ) : (
                    <Button title={t('Give to a car')} icon="bus-outline" onPress={() => setGiving(b.id)} />
                  )}
                </Card>
              );
            })
          )}

          {route.later.length > 0 && (
            <>
              <SectionTitle>{t('Booked for later')}</SectionTitle>
              <Card>
                <Muted>{t('Paid. Each joins the queue at their time, ahead of anyone who chose a later time.')}</Muted>
                {route.later.map((b) => (
                  <View key={b.id} style={styles.row}>
                    {passengerLine(b, [b.ready_at ? dayTime(b.ready_at) : '', b.pickup_name ? t('pick at {place}', { place: b.pickup_name }) : ''].filter(Boolean).join(' · '))}
                    <Pressable onPress={() => call(b.passenger_phone)} hitSlop={8} accessibilityLabel={t('Call {name}', { name: b.passenger_name })}>
                      <Ionicons name="call-outline" size={24} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={() => cancel(b)} hitSlop={8} style={{ marginLeft: 16 }} accessibilityLabel={t('Cancel booking {code}?', { code: b.code })}>
                      <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            </>
          )}

          <SectionTitle>{t('On the road')}</SectionTitle>
          {onRoad.length === 0 && <Muted>{t('No cars on the road.')}</Muted>}
          {onRoad.some((c) => c.location) && (
            <CarMap
              height={280}
              cars={onRoad.filter((c) => c.location).map((c) => ({ id: c.load_id, lat: c.location!.lat, lng: c.location!.lng, label: c.plate }))}
            />
          )}
          {onRoad.map((car) => {
            const toPick = car.bookings.filter((b) => b.status === 'assigned');
            return (
              <Card key={car.load_id}>
                <View style={styles.carHead}>
                  <Text style={styles.plate}>{car.plate}</Text>
                  <Badge text={t('{n} left', { n: car.seats_left })} />
                </View>
                <Muted>{t('Left the stage at {time}', { time: car.departed_at ? time(car.departed_at) : '—' })}</Muted>
                {crewButton(car)}
                {toPick.map((b) => (
                  <View key={b.id} style={styles.row}>
                    {passengerLine(b, b.pickup_name ? t('pick at {place}', { place: b.pickup_name }) : undefined)}
                  </View>
                ))}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  carHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plate: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  callText: { color: colors.primary, fontWeight: '600' },
});
