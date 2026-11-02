import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useT } from '@/lib/i18n';
import type { Stop } from '@/lib/types';
import { colors } from './ui';

/** The search box above a list of routes. */
export function RouteSearch({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) {
  const { t } = useT();
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={20} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={t('Search a stage or destination')}
        placeholderTextColor={colors.muted}
        style={styles.searchInput}
        autoCorrect={false}
        returnKeyType="search"
      />
      {!!value && (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel={t('Clear')}>
          <Ionicons name="close-circle" size={20} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

/** True when the route's name, start or any stop contains what was typed. */
export function routeMatches(route: { name: string; origin: string; stops: Stop[] }, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [route.name, route.origin, ...route.stops.map((s) => s.name)].some((text) => text.toLowerCase().includes(q));
}

/** "Origin → last stop" for a route's subtitle. */
export function routeEnds(route: { origin: string; stops: Stop[] }) {
  const last = route.stops[route.stops.length - 1];
  return last ? `${route.origin} → ${last.name}` : route.origin;
}

/** A route in its own rounded card: start-and-end line on the left, chevron (or something else) on the right. Children show under it. */
export function RouteCard({
  title,
  subtitle,
  right,
  rightSub,
  icon = 'chevron-forward',
  onPress,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: string;
  rightSub?: ReactNode;
  icon?: 'chevron-forward' | 'chevron-down' | 'chevron-up' | 'checkmark-circle';
  onPress?: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.header, pressed && onPress && { backgroundColor: '#F3F4F6' }]}>
        <View style={styles.line}>
          <View style={styles.start} />
          <View style={styles.stem} />
          <View style={styles.end} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
        </View>
        {(right !== undefined || rightSub) && (
          <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
            {right !== undefined && <Text style={styles.right}>{right}</Text>}
            {rightSub}
          </View>
        )}
        <Ionicons name={icon} size={icon === 'checkmark-circle' ? 22 : 20} color={icon === 'checkmark-circle' ? colors.primary : colors.muted} style={{ marginLeft: 8 }} />
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 14 },
  card: { backgroundColor: colors.card, borderRadius: 14, marginBottom: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 14 },
  line: { width: 14, alignItems: 'center', marginRight: 14 },
  start: { width: 11, height: 11, borderRadius: 6, borderWidth: 2.5, borderColor: colors.primary, backgroundColor: colors.card },
  stem: { width: 2, height: 14, backgroundColor: `${colors.primary}66` },
  end: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.muted, marginTop: 3 },
  right: { fontSize: 15, fontWeight: '600', color: colors.text },
});
