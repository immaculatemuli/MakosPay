import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Badge, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { kes, nairobiDate, prettyDate, time } from '@/lib/format';
import { ROLE_LABEL, type ConductorDay, type ConductorVehicle, type Run } from '@/lib/types';
import { TripCard } from './TripCard';
import { useApi } from '@/lib/useApi';

const REFRESH_EVERY_MS = 10_000;

const DAYS = [
  { value: 0, label: 'Today' },
  { value: -1, label: 'Yesterday' },
  { value: -2, label: '2 days ago' },
  { value: -3, label: '3 days ago' },
];

/**
 * A conductor's or driver's vehicle, the day's totals and every payment made on it.
 * Only conductors can change the route; drivers see it without the "change" option.
 */
export function CrewHome() {
  const { user } = useAuth();
  const isConductor = user?.role === 'conductor';
  const roleLabel = user ? ROLE_LABEL[user.role] : '';
  const [day, setDay] = useState(0);
  const vehicle = useApi<ConductorVehicle>('/crew/vehicle');
  const date = nairobiDate(day);
  const payments = useApi<ConductorDay>(`/crew/payments?date=${date}`);
  const currentRun = useApi<Run | null>('/crew/runs/current');

  // New payments appear on their own: check every 10 seconds while this screen is open.
  const reloadPayments = payments.reload;
  const reloadRun = currentRun.reload;
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        void reloadPayments();
        void reloadRun();
      }, REFRESH_EVERY_MS);
      return () => clearInterval(timer);
    }, [reloadPayments, reloadRun]),
  );

  if (vehicle.loading && !vehicle.data) return <Loading />;

  if (!vehicle.data) {
    return (
      <Screen refreshing={vehicle.refreshing} onRefresh={vehicle.refresh}>
        <Hero name={user?.name} subtitle={roleLabel} />
        <Notice>{vehicle.error ?? 'You are not on a vehicle yet.'}</Notice>
      </Screen>
    );
  }

  const v = vehicle.data;
  const summary = payments.data?.summary;
  const refresh = () => {
    vehicle.refresh();
    payments.refresh();
    currentRun.refresh();
  };

  return (
    <Screen refreshing={payments.refreshing || vehicle.refreshing} onRefresh={refresh}>
      <Hero name={user?.name} subtitle={`${roleLabel} · ${v.vehicle.plate}`}>
        <View style={styles.totals}>
          <View>
            <Text style={styles.totalLabel}>{day === 0 ? 'Collected today' : `Collected ${prettyDate(date)}`}</Text>
            <Text style={styles.total}>{summary ? kes(summary.total) : '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.totalLabel}>Payments</Text>
            <Text style={styles.total}>{summary?.payments ?? '—'}</Text>
          </View>
        </View>
      </Hero>

      <Pressable
        style={({ pressed }) => [styles.routeCard, pressed && isConductor && { opacity: 0.7 }]}
        onPress={isConductor ? () => router.push('/conductor/change-route') : undefined}
        disabled={!isConductor}
      >
        <Ionicons name="map-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.routeName}>{v.route ? v.route.name : 'No route set'}</Text>
          <Text style={styles.routeSub}>
            {!isConductor
              ? v.route
                ? `From ${v.route.origin} · the conductor changes the route`
                : 'Ask the conductor or SACCO office to set the route'
              : v.route
                ? `From ${v.route.origin} · tap to change route`
                : 'Tap to choose the route you are on'}
          </Text>
        </View>
        {isConductor && <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />}
      </Pressable>
      {!v.route && <Notice>Passengers can't pay until the vehicle has a route.</Notice>}

      <TripCard
        current={currentRun.loading && !currentRun.data ? undefined : currentRun.data}
        hasRoute={!!v.route}
        onChange={() => {
          void currentRun.reload();
          void payments.reload();
        }}
      />

      <SectionTitle>Payments</SectionTitle>
      <Chips options={DAYS} value={day} onChange={setDay} />
      {payments.error && <ErrorBox message={payments.error} onRetry={payments.reload} />}
      {payments.data?.payments.length === 0 && <Empty text={day === 0 ? 'No payments yet today.' : 'No payments that day.'} />}
      {!!payments.data?.payments.length && (
        <List>
          {payments.data.payments.map((p) => (
            <ListRow
              key={p.id}
              icon="person-circle-outline"
              title={p.passenger_name ?? 'Passenger'}
              subtitle={`${time(p.created_at)} · to ${p.stop_name ?? p.route_name} · ${p.ticket_code}`}
              right={kes(p.fare)}
              rightSub={p.status === 'refunded' ? <Badge text="Refunded" tone="danger" /> : undefined}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  totalLabel: { color: '#D1FAE5', fontSize: 13 },
  total: { color: '#fff', fontSize: 30, fontWeight: '800' },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  routeName: { fontSize: 17, fontWeight: '700', color: colors.text },
  routeSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
