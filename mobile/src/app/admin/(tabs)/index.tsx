import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Card, colors, ErrorBox, List, ListRow, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { kes } from '@/lib/format';
import type { DaySummary } from '@/lib/types';
import { useApi } from '@/lib/useApi';

interface Summary {
  routes: number;
  vehicles: number;
  vehicles_without_route: number;
  conductors: number;
  drivers: number;
  passengers: number;
  today: DaySummary;
  owed_to_owners: number;
  open_reports: number;
}

type IconName = ComponentProps<typeof Ionicons>['name'];

function Tile({ icon, value, label, href }: { icon: IconName; value: number; label: string; href?: Href }) {
  return (
    <Pressable
      onPress={href ? () => router.navigate(href) : undefined}
      disabled={!href}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.tileIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

export default function AdminHome() {
  const { user } = useAuth();
  const summary = useApi<Summary>('/admin/summary');
  if (summary.loading && !summary.data) return <Loading />;
  const s = summary.data;

  // The next thing to set up, in order: route, vehicle, then a route for every vehicle.
  const nextStep = !s
    ? null
    : s.routes === 0
      ? 'Start by adding your first route and its fares.'
      : s.vehicles === 0
        ? 'Next, add a vehicle with its owner and print its QR sticker.'
        : s.vehicles_without_route > 0
          ? `${s.vehicles_without_route} vehicle${s.vehicles_without_route === 1 ? ' has' : 's have'} no route yet. Passengers can't pay until it has one.`
          : null;

  return (
    <Screen refreshing={summary.refreshing} onRefresh={summary.refresh}>
      <Hero name={user?.name} subtitle="SACCO office">
        {s && (
          <Pressable style={styles.heroTotals} onPress={() => router.navigate('/admin/payments')}>
            <View>
              <Text style={styles.heroLabel}>Collected today</Text>
              <Text style={styles.heroValue}>{kes(s.today.total)}</Text>
              <Text style={styles.heroLabel}>
                {s.today.payments} payment{s.today.payments === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.heroLabel}>Owed to owners</Text>
              <Text style={styles.heroValue}>{kes(s.owed_to_owners)}</Text>
            </View>
          </Pressable>
        )}
      </Hero>

      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      <List>
        <ListRow
          icon="bar-chart-outline"
          title="Dashboard"
          subtitle="Collections by day, route and vehicle"
          onPress={() => router.push('/admin/dashboard')}
        />
      </List>
      {nextStep && <Notice>{nextStep}</Notice>}
      {!!s?.open_reports && (
        <ListRow
          icon="chatbox-ellipses-outline"
          title={`${s.open_reports} problem report${s.open_reports === 1 ? '' : 's'} waiting`}
          subtitle="Tap to read and reply"
          onPress={() => router.push('/admin/reports')}
        />
      )}

      {s && (
        <View style={styles.tiles}>
          <Tile icon="map-outline" value={s.routes} label="Routes" href="/admin/routes" />
          <Tile icon="bus-outline" value={s.vehicles} label="Vehicles" href="/admin/vehicles" />
          <Tile icon="people-outline" value={s.conductors} label="Conductors" href={{ pathname: '/admin/crew', params: { role: 'conductor' } }} />
          <Tile icon="person-outline" value={s.passengers} label="Passengers" href="/admin/passengers" />
        </View>
      )}

      <SectionTitle>Quick actions</SectionTitle>
      <List>
        <ListRow icon="people-outline" title="Bookings & trips" subtitle="Cars loading at the stage and on the road" onPress={() => router.push('/admin/trips')} />
        <ListRow icon="cube-outline" title="Parcels" subtitle="Record, find and hand over parcels" onPress={() => router.push('/admin/parcels')} />
        <ListRow icon="add-circle-outline" title="Add route" subtitle="Drop-off stops and their fares" onPress={() => router.push('/admin/route-form')} />
        <ListRow icon="add-circle-outline" title="Add vehicle" subtitle="Plate, owner's M-Pesa number, QR sticker" onPress={() => router.push('/admin/vehicle-form')} />
        <ListRow icon="person-add-outline" title="Add conductor" subtitle="Creates their sign-in" onPress={() => router.push({ pathname: '/admin/crew-form', params: { role: 'conductor' } })} />
        <ListRow icon="car-outline" title="Add driver" subtitle="Creates their sign-in" onPress={() => router.push({ pathname: '/admin/crew-form', params: { role: 'driver' } })} />
        <ListRow icon="chatbox-ellipses-outline" title="Problem reports" subtitle="From passengers and crew" onPress={() => router.push('/admin/reports')} />
        <ListRow icon="arrow-up-circle-outline" title="Passenger withdrawals" subtitle="Wallet money sent back to M-Pesa" onPress={() => router.push('/admin/withdrawals')} />
        <ListRow icon="checkmark-done-outline" title="Money check" subtitle="Do wallets, M-Pesa and payouts add up?" onPress={() => router.push('/admin/reconciliation')} />
        <ListRow icon="document-text-outline" title="M-Pesa statement check" subtitle="Match the Paybill statement with FarePay" onPress={() => router.push('/admin/statement')} />
        <ListRow icon="list-outline" title="Audit log" subtitle="Who changed what, and when" onPress={() => router.push('/admin/audit')} />
        <ListRow icon="briefcase-outline" title="Office staff" subtitle="Other SACCO office accounts" onPress={() => router.push('/admin/staff')} />
        {user?.role === 'platform_admin' && (
          <ListRow icon="shield-checkmark-outline" title="Platform" subtitle="Payment setup and platform admins" onPress={() => router.push('/admin/platform')} />
        )}
      </List>

      <SectionTitle>Today by vehicle</SectionTitle>
      {s && s.today.by_vehicle.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Ionicons name="cash-outline" size={32} color={colors.muted} />
          <Muted center>No payments yet today. Each vehicle’s takings will show here.</Muted>
        </Card>
      ) : (
        <List>
          {s?.today.by_vehicle.map((v) => (
            <ListRow
              key={v.id}
              icon="bus-outline"
              title={v.plate}
              subtitle={`Owner ${v.owner_name} · ${v.payments} payment${v.payments === 1 ? '' : 's'}`}
              right={kes(v.total)}
              onPress={() => router.navigate('/admin/payments')}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroTotals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  heroLabel: { color: colors.primarySoft, fontSize: 13 },
  heroValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tileIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tileValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  tileLabel: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
