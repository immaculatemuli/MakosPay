import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Badge, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { kes, nairobiDate, prettyDate, time } from '@/lib/format';
import type { ConductorDay, ConductorVehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const REFRESH_EVERY_MS = 10_000;

const DAYS = [
  { value: 0, label: 'Today' },
  { value: -1, label: 'Yesterday' },
  { value: -2, label: '2 days ago' },
  { value: -3, label: '3 days ago' },
];

/** The conductor's vehicle, the day's totals and every payment made on it. */
export default function ConductorHome() {
  const { user } = useAuth();
  const [day, setDay] = useState(0);
  const vehicle = useApi<ConductorVehicle>('/conductor/vehicle');
  const date = nairobiDate(day);
  const payments = useApi<ConductorDay>(`/conductor/payments?date=${date}`);

  // New payments appear on their own: check every 10 seconds while this screen is open.
  const reloadPayments = payments.reload;
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void reloadPayments(), REFRESH_EVERY_MS);
      return () => clearInterval(timer);
    }, [reloadPayments]),
  );

  if (vehicle.loading && !vehicle.data) return <Loading />;

  if (!vehicle.data) {
    return (
      <Screen refreshing={vehicle.refreshing} onRefresh={vehicle.refresh}>
        <Hero name={user?.name} subtitle="Conductor" />
        <Notice>{vehicle.error ?? 'You are not on a vehicle yet.'}</Notice>
      </Screen>
    );
  }

  const v = vehicle.data;
  const summary = payments.data?.summary;
  const refresh = () => {
    vehicle.refresh();
    payments.refresh();
  };

  return (
    <Screen refreshing={payments.refreshing || vehicle.refreshing} onRefresh={refresh}>
      <Hero name={user?.name} subtitle={`Conductor · ${v.vehicle.plate}`}>
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

      <Pressable style={({ pressed }) => [styles.routeCard, pressed && { opacity: 0.7 }]} onPress={() => router.push('/conductor/change-route')}>
        <Ionicons name="map-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.routeName}>{v.route ? v.route.name : 'No route set'}</Text>
          <Text style={styles.routeSub}>{v.route ? `From ${v.route.origin} · tap to change route` : 'Tap to choose the route you are on'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </Pressable>
      {!v.route && <Notice>Passengers can't pay until the vehicle has a route.</Notice>}

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
