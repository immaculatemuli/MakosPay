import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { saveChosenStop, useChosenStop } from '@/lib/chosenRoute';
import { kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { PassengerSummary, PublicRoute, Stop } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Pick a route, then the stop where you'll get off. The star saves a drop-off for one-tap choosing on Home and Pay. */
export default function ChooseRoute() {
  const { t } = useT();
  const routes = useApi<PublicRoute[]>('/passenger/routes');
  const current = useChosenStop();
  const summary = useApi<PassengerSummary>('/passenger/summary');
  const savedIds = new Set((summary.data?.saved ?? []).map((s) => s.stop_id));

  const toggleSaved = async (stopId: number) => {
    if (savedIds.has(stopId)) await api(`/passenger/saved-stops/${stopId}`, { method: 'DELETE' }).catch(() => {});
    else await api('/passenger/saved-stops', { method: 'POST', body: { stop_id: stopId } }).catch(() => {});
    await summary.reload();
  };
  const [open, setOpen] = useState<number | null>(null);
  if (routes.loading && !routes.data) return <Loading />;
  const openId = open ?? current?.route_id ?? null;

  const choose = async (route: PublicRoute, stop: Stop) => {
    await saveChosenStop({ route_id: route.id, route_name: route.name, stop_id: stop.id, stop_name: stop.name });
    router.back();
  };

  return (
    <Screen refreshing={routes.refreshing} onRefresh={routes.refresh}>
      {routes.error && <ErrorBox message={routes.error} onRetry={routes.reload} />}
      {routes.data?.length === 0 && <Empty text={t('No routes yet.')} />}
      <Muted>{t('Tap your route, then where you’ll get off. Tap ☆ to save a drop-off.')}</Muted>
      <View style={{ height: 10 }} />
      {routes.data?.map((r) => {
        const expanded = openId === r.id;
        return (
          <View key={r.id} style={styles.route}>
            <Pressable style={styles.routeHeader} onPress={() => setOpen(expanded ? -1 : r.id)}>
              <Ionicons name="map-outline" size={22} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.routeName}>{r.name}</Text>
                <Text style={styles.routeSub}>{t('From {place}', { place: r.origin })} · {t(r.stops.length === 1 ? '{n} drop-off' : '{n} drop-offs', { n: r.stops.length })}</Text>
              </View>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
            </Pressable>
            {expanded &&
              r.stops.map((s) => {
                const selected = current?.stop_id === s.id;
                return (
                  <Pressable key={s.id} style={({ pressed }) => [styles.stop, pressed && { backgroundColor: '#F3F4F6' }]} onPress={() => choose(r, s)}>
                    <Ionicons name={selected ? 'checkmark-circle' : 'location-outline'} size={20} color={selected ? colors.primary : colors.muted} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.stopName}>{s.name}</Text>
                    </View>
                    <Text style={styles.fare}>{kes(s.app_fare)}</Text>
                    <Pressable onPress={() => toggleSaved(s.id)} hitSlop={10} style={{ marginLeft: 14 }} accessibilityLabel={savedIds.has(s.id) ? t('Remove from saved') : t('Save this drop-off')}>
                      <Ionicons name={savedIds.has(s.id) ? 'star' : 'star-outline'} size={22} color={savedIds.has(s.id) ? colors.primary : colors.muted} />
                    </Pressable>
                  </Pressable>
                );
              })}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  route: { backgroundColor: colors.card, borderRadius: 14, marginBottom: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  routeHeader: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  routeName: { fontSize: 17, fontWeight: '700', color: colors.text },
  routeSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  stop: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stopName: { fontSize: 15, fontWeight: '600', color: colors.text },
  fare: { fontSize: 15, fontWeight: '700', color: colors.text },
});
