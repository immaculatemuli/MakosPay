import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '@/lib/i18n';
import type { FreeRideProgress } from '@/lib/types';
import { colors } from './ui';

/** Loyalty on the passenger's home: how many paid rides until the next free one, or that the next ride is free. */
export function FreeRideCard({ p }: { p: FreeRideProgress }) {
  const { t } = useT();
  const share = p.needed ? Math.min(1, p.rides / p.needed) : 0;
  if (p.next_is_free) {
    return (
      <View style={[styles.card, styles.ready]}>
        <Ionicons name="gift" size={32} color="#FFFFFF" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: '#FFFFFF' }]}>{t('Your next ride is free')}</Text>
          <Text style={[styles.sub, { color: colors.primarySoft }]}>{t('Pay your next fare as usual: nothing will be taken.')}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.card} accessibilityLabel={t('{rides} of {needed} rides: your {nth} ride is free', { rides: p.rides, needed: p.needed, nth: `${p.every}th` })}>
      <Ionicons name="gift-outline" size={28} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{t('{rides} of {needed} rides', { rides: p.rides, needed: p.needed })}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
        </View>
        <Text style={styles.sub}>{t('Your {nth} ride is free. Rides from the last {days} days count.', { nth: `${p.every}th`, days: p.window_days })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ready: { backgroundColor: colors.primary, borderColor: colors.primary },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.primarySoft, marginTop: 8, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
});
