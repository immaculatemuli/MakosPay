import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Badge, Button, colors, Empty, ErrorBox, List, ListRow, Loading, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useChosenStop } from '@/lib/chosenRoute';
import { dateTime, kes } from '@/lib/format';
import type { Paged, Trip } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { openTicket } from '@/lib/ticket';

export default function PassengerHome() {
  const { user } = useAuth();
  const wallet = useApi<{ balance: number }>('/passenger/wallet');
  const recent = useApi<Paged<Trip>>('/passenger/trips?limit=3');
  const chosen = useChosenStop();

  if (wallet.loading && !wallet.data) return <Loading />;
  const refresh = () => {
    wallet.refresh();
    recent.refresh();
  };

  return (
    <Screen refreshing={wallet.refreshing} onRefresh={refresh}>
      <Hero name={user?.name}>
        <Text style={styles.balanceLabel}>Wallet balance</Text>
        <Text style={styles.balance}>{wallet.data ? kes(wallet.data.balance) : '—'}</Text>
        <View style={styles.heroButtons}>
          <Pressable style={({ pressed }) => [styles.heroButton, styles.heroButtonSolid, pressed && { opacity: 0.8 }]} onPress={() => router.push('/passenger/topup')}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <Text style={[styles.heroButtonText, { color: colors.primary }]}>Top up</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.heroButton, pressed && { opacity: 0.8 }]} onPress={() => router.push('/passenger/wallet')}>
            <Ionicons name="time-outline" size={18} color="#fff" />
            <Text style={styles.heroButtonText}>History</Text>
          </Pressable>
        </View>
      </Hero>
      {wallet.error && <ErrorBox message={wallet.error} onRetry={wallet.reload} />}

      <SectionTitle>Where are you going?</SectionTitle>
      <Pressable style={({ pressed }) => [styles.routeCard, pressed && { opacity: 0.7 }]} onPress={() => router.push('/passenger/choose-route')}>
        <Ionicons name="map-outline" size={24} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.routeName}>{chosen ? `Get off at ${chosen.stop_name}` : 'Choose your route and drop-off'}</Text>
          <Text style={styles.routeHint}>{chosen ? `${chosen.route_name} · tap to change` : 'Your fare depends on where you get off'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </Pressable>

      <View style={{ height: 6 }} />
      <Button title="Scan to pay" icon="qr-code-outline" onPress={() => router.push('/passenger/scan')} />

      <SectionTitle>Recent payments</SectionTitle>
      {recent.data?.items.length === 0 && <Empty text="No payments yet. Scan the QR code inside the vehicle to pay." />}
      {!!recent.data?.items.length && (
        <List>
          {recent.data.items.map((t) => (
            <ListRow
              key={t.id}
              icon="bus-outline"
              title={`${t.plate} · to ${t.stop_name ?? t.route_name}`}
              subtitle={dateTime(t.created_at)}
              right={kes(t.fare)}
              rightSub={t.status === 'refunded' ? <Badge text="Refunded" tone="danger" /> : undefined}
              onPress={() => openTicket(t)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceLabel: { color: '#D1FAE5', fontSize: 13, marginTop: 16 },
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
  routeHint: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
