import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge, colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { saveChosenStop, useChosenStop } from '@/lib/chosenRoute';
import { kes } from '@/lib/format';
import type { PublicRoute, Stop } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Pick a route, then the stop where you'll get off. */
export default function ChooseRoute() {
  const routes = useApi<PublicRoute[]>('/passenger/routes');
  const current = useChosenStop();
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
      {routes.data?.length === 0 && <Empty text="No routes yet." />}
      <Muted>Tap your route, then where you'll get off.</Muted>
      <View style={{ height: 10 }} />
      {routes.data?.map((r) => {
        const expanded = openId === r.id;
        return (
          <View key={r.id} style={styles.route}>
            <Pressable style={styles.routeHeader} onPress={() => setOpen(expanded ? -1 : r.id)}>
              <Ionicons name="map-outline" size={22} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.routeName}>{r.name}</Text>
                <Text style={styles.routeSub}>From {r.origin} · {r.stops.length} drop-off{r.stops.length === 1 ? '' : 's'}</Text>
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
                      <Text style={styles.routeSub}>Cash {kes(s.cash_fare)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.fare}>{kes(s.app_fare)}</Text>
                      {s.you_save > 0 && <Badge text={`Save ${kes(s.you_save)}`} tone="success" />}
                    </View>
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
