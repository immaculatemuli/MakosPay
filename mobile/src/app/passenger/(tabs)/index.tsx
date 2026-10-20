import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Hero } from '@/components/Hero';
import { FreeRideCard } from '@/components/FreeRideCard';
import { OpenBookingCard } from '@/components/OpenBookingCard';
import { WhereGoing } from '@/components/WhereGoing';
import { Badge, colors, Empty, ErrorBox, List, ListRow, Loading, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useChosenStop } from '@/lib/chosenRoute';
import { dateTime, kes, monthName } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { saveTickets } from '@/lib/savedTickets';
import { openTicket } from '@/lib/ticket';
import type { Paged, PassengerSummary, SeatBooking, Trip } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Passenger home: balance, Add money / Pay fare, trips and spending, where they're going, recent payments. */
export default function PassengerHome() {
  const { user } = useAuth();
  const { t } = useT();
  const summary = useApi<PassengerSummary>('/passenger/summary');
  const recent = useApi<Paged<Trip>>('/passenger/trips?limit=3');
  // A booking happening now (paying, in the queue, a car coming) leads the screen; a car on its way first.
  const seats = useApi<SeatBooking[]>('/passenger/seats');
  const open = (seats.data ?? []).filter((b) => ['paying', 'queued', 'assigned'].includes(b.status)).sort((a, b) => Number(b.status === 'assigned') - Number(a.status === 'assigned'));
  const reloadSeats = seats.reload;
  const hasOpen = open.length > 0;
  useFocusEffect(
    useCallback(() => {
      if (!hasOpen) return;
      const timer = setInterval(() => void reloadSeats(), 15_000);
      return () => clearInterval(timer);
    }, [hasOpen, reloadSeats]),
  );
  const [pickKey, setPickKey] = useState(0);
  const chosen = useChosenStop(pickKey);
  // The latest tickets are kept on the phone, to open without internet.
  useEffect(() => {
    if (recent.data?.items.length) void saveTickets(recent.data.items);
  }, [recent.data]);

  if (summary.loading && !summary.data) return <Loading />;
  const s = summary.data;
  const refresh = () => {
    summary.refresh();
    recent.refresh();
    seats.refresh();
  };
  const joined = s ? new Date(s.since_joining.joined_at) : null;

  return (
    <Screen refreshing={summary.refreshing} onRefresh={refresh}>
      <Hero name={user?.name} subtitle={s?.sacco_name}>
        <Text style={styles.balanceLabel}>{t('Wallet balance')}</Text>
        <Text style={styles.balance}>{s ? kes(s.balance) : '—'}</Text>
        <View style={styles.heroButtons}>
          <Pressable style={({ pressed }) => [styles.heroButton, styles.heroButtonSolid, pressed && { opacity: 0.8 }]} onPress={() => router.push('/passenger/topup')}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={[styles.heroButtonText, { color: colors.primary }]}>{t('Add money')}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.heroButton, pressed && { opacity: 0.8 }]} onPress={() => router.push('/passenger/scan')}>
            <Ionicons name="qr-code-outline" size={18} color="#fff" />
            <Text style={styles.heroButtonText}>{t('Pay fare')}</Text>
          </Pressable>
        </View>
      </Hero>
      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      {open.map((b) => (
        <OpenBookingCard key={b.id} booking={b} />
      ))}

      {s && (
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{kes(s.this_month.spent)}</Text>
            <Text style={styles.statLabel}>{t('Spent this month')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{s.since_joining.trips}</Text>
            <Text style={styles.statLabel}>{joined ? t('Trips since {when}', { when: `${monthName(joined.getMonth())} ${joined.getFullYear()}` }) : t('Trips since joining')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{s.this_month.trips}</Text>
            <Text style={styles.statLabel}>{t('Trips this month')}</Text>
          </View>
        </View>
      )}

      {s && s.free_ride.every > 0 && <FreeRideCard p={s.free_ride} />}

      <List>
        <ListRow icon="people-outline" title={t('Book a seat')} subtitle={t('From anywhere: at the stage or on the road')} onPress={() => router.push('/passenger/book')} />
        <ListRow icon="cube-outline" title={t('Track a parcel')} subtitle={t('With the tracking code from the receipt')} onPress={() => router.push('/passenger/parcel')} />
      </List>

      <SectionTitle>{t('Where are you going?')}</SectionTitle>
      <WhereGoing chosen={chosen} saved={s?.saved ?? []} frequent={s?.frequent ?? []} onChosen={() => setPickKey((k) => k + 1)} />

      <SectionTitle>{t('Recent trips')}</SectionTitle>
      {recent.data?.items.length === 0 && <Empty text={t('No trips yet. Scan the QR code inside the vehicle to pay.')} />}
      {!!recent.data?.items.length && (
        <List>
          {recent.data.items.map((trip) => (
            <ListRow
              key={trip.id}
              icon="bus-outline"
              title={`${trip.plate} · ${t('to {place}', { place: trip.stop_name ?? trip.route_name })}`}
              subtitle={dateTime(trip.created_at)}
              right={kes(trip.fare)}
              rightSub={trip.status === 'refunded' ? <Badge text={t('Refunded')} tone="danger" /> : undefined}
              onPress={() => openTicket(trip)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceLabel: { color: colors.primarySoft, fontSize: 13, marginTop: 16 },
  balance: { color: '#fff', fontSize: 34, fontWeight: '800' },
  heroButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  heroButtonSolid: { backgroundColor: '#fff', borderColor: '#fff' },
  heroButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statValue: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
