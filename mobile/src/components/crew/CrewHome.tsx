import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Badge, Button, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { kes, nairobiDate, prettyDate, time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { ROLE_LABEL, type ConductorDay, type ConductorVehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { useKeepAwakeWhile } from '@/lib/keepAwake';
import { CashCard } from './CashCard';
import { usePaymentFeed } from './usePaymentFeed';

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
  const { t } = useT();
  const isConductor = user?.role === 'conductor';
  const roleLabel = user ? t(ROLE_LABEL[user.role]) : '';
  const [day, setDay] = useState(0);
  const vehicle = useApi<ConductorVehicle>('/crew/vehicle');
  const date = nairobiDate(day);
  const payments = useApi<ConductorDay>(`/crew/payments?date=${date}`);

  // New payments appear within seconds, with a sound, a vibration and a big alert.
  const feed = usePaymentFeed(payments.data, day === 0 && payments.data?.date === date, payments.reload);
  // The feed only rings while the app is open: the screen stays on while today's payments are showing.
  useKeepAwakeWhile(day === 0, 'crew-payments');

  if (vehicle.loading && !vehicle.data) return <Loading />;

  // Crew choose their car by scanning its sticker (they switch cars and cover for each other).
  const scanCarHref = isConductor ? '/conductor/scan-car' : '/driver/scan-car';

  if (!vehicle.data) {
    return (
      <Screen refreshing={vehicle.refreshing} onRefresh={vehicle.refresh}>
        <Hero name={user?.name} subtitle={roleLabel} />
        <Notice>{vehicle.error ?? t('You are not on a vehicle yet.')}</Notice>
        <Button title={t('Scan the QR sticker in your car')} icon="qr-code-outline" onPress={() => router.push(scanCarHref)} />
      </Screen>
    );
  }

  const v = vehicle.data;
  const summary = payments.data?.summary;
  const refresh = () => {
    vehicle.refresh();
    payments.refresh();
  };

  const trip = payments.data?.trip;
  const latest = feed.fresh[0];

  return (
    <View style={{ flex: 1 }}>
    <Screen refreshing={payments.refreshing || vehicle.refreshing} onRefresh={refresh}>
      <Hero name={user?.name} subtitle={`${roleLabel} · ${v.vehicle.plate}`}>
        <View style={styles.totals}>
          <View>
            <Text style={styles.totalLabel}>{day === 0 ? t('Collected today') : t('Collected {when}', { when: prettyDate(date) })}</Text>
            <Text style={styles.total}>{summary ? kes(summary.total) : '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.totalLabel}>{t('Payments')}</Text>
            <Text style={styles.total}>{summary?.payments ?? '—'}</Text>
          </View>
        </View>
      </Hero>

      {day === 0 && trip && (
        <View style={styles.tripCard}>
          <Text style={styles.tripLabel}>
            {trip.finished_at
              ? t('Last trip · finished {time}', { time: time(trip.finished_at) })
              : t('This trip · since {time}', { time: time(trip.started_at) })}
          </Text>
          <Text style={styles.tripTotal}>
            {t('{n} paid', { n: trip.payments })} · {kes(trip.total)}
          </Text>
          <Text style={styles.tripSub}>{trip.route_name}</Text>
        </View>
      )}

      {day >= -1 && payments.data?.date === date && (
        <CashCard day={date} isToday={day === 0} cash={payments.data.cash} farepayTotal={payments.data.summary.total} onSaved={() => void payments.reload()} />
      )}

      <Pressable
        style={({ pressed }) => [styles.routeCard, pressed && isConductor && { opacity: 0.7 }]}
        onPress={isConductor ? () => router.push('/conductor/change-route') : undefined}
        disabled={!isConductor}
      >
        <Ionicons name="map-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.routeName}>{v.route ? v.route.name : t('No route set')}</Text>
          <Text style={styles.routeSub}>
            {!isConductor
              ? v.route
                ? `${t('From {place}', { place: v.route.origin })} · ${t('the conductor changes the route')}`
                : t('Ask the conductor or SACCO office to set the route')
              : v.route
                ? `${t('From {place}', { place: v.route.origin })} · ${t('tap to change route')}`
                : t('Tap to choose the route you are on')}
          </Text>
        </View>
        {isConductor && <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />}
      </Pressable>
      {!v.route && <Notice>{t('Passengers can’t pay until the vehicle has a route.')}</Notice>}
      <List>
        <ListRow
          icon={feed.speak ? 'volume-high-outline' : 'volume-mute-outline'}
          title={feed.speak ? t('Payments are read aloud') : t('Payments are not read aloud')}
          subtitle={feed.speak ? t('Tap to turn off') : t('Tap to turn on: useful when driving alone')}
          onPress={feed.toggleSpeak}
        />
        <ListRow icon="swap-horizontal-outline" title={t('Working on another car today?')} subtitle={t('Scan the QR sticker inside it')} onPress={() => router.push(scanCarHref)} />
      </List>

      <SectionTitle>{t('Payments')}</SectionTitle>
      <Chips options={DAYS.map((d) => ({ ...d, label: t(d.label) }))} value={day} onChange={setDay} />
      {payments.error && <ErrorBox message={payments.error} onRetry={payments.reload} />}
      {payments.data?.payments.length === 0 && <Empty text={day === 0 ? t('No payments yet today.') : t('No payments that day.')} />}
      {!!payments.data?.payments.length && (
        <List>
          {payments.data.payments.map((p) => (
            <ListRow
              key={p.id}
              icon="person-circle-outline"
              title={p.passenger_name ?? t('Passenger')}
              subtitle={[time(p.created_at), p.passenger_phone, t('to {place}', { place: p.stop_name ?? p.route_name }), p.ticket_code].filter(Boolean).join(' · ')}
              right={kes(p.fare)}
              rightSub={
                p.status === 'refunded' ? (
                  <Badge text={t('Refunded')} tone="danger" />
                ) : p.free_ride ? (
                  // Loyalty: the passenger paid nothing; the SACCO pays the owner this fare.
                  <Badge text={t('Free ride')} tone="success" />
                ) : undefined
              }
            />
          ))}
        </List>
      )}
    </Screen>
      {latest && (
        <Pressable style={styles.alert} onPress={feed.dismiss} accessibilityRole="alert">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="checkmark-circle" size={40} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertAmount}>{t('{amount} paid', { amount: kes(latest.fare) })}</Text>
              <Text style={styles.alertLine}>
                {[latest.passenger_phone, t('to {place}', { place: latest.stop_name ?? latest.route_name })].filter(Boolean).join(' · ')}
              </Text>
              {latest.passenger_name && <Text style={styles.alertLine}>{latest.passenger_name}</Text>}
              {feed.fresh.length > 1 && <Text style={styles.alertMore}>{t('+{n} more just paid', { n: feed.fresh.length - 1 })}</Text>}
            </View>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  totalLabel: { color: colors.primarySoft, fontSize: 13 },
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
  tripCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  tripLabel: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  tripTotal: { fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 2 },
  tripSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  alert: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: '#15803D',
    borderRadius: 16,
    padding: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  alertAmount: { color: '#fff', fontSize: 28, fontWeight: '800' },
  alertLine: { color: '#fff', fontSize: 17, fontWeight: '600', marginTop: 2 },
  alertMore: { color: '#DCFCE7', fontSize: 14, marginTop: 4 },
  routeName: { fontSize: 17, fontWeight: '700', color: colors.text },
  routeSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
