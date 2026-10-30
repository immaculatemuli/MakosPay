import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Empty, ErrorBox, Field, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { MarshalVehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/**
 * A car reached the stage (?route=, origin=): find it by plate and say so. It starts loading on this route and the
 * first passengers in the queue are put on it at once (they are told which car to board).
 */
export default function CarArrived() {
  const { t } = useT();
  const params = useLocalSearchParams<{ route?: string; origin?: string }>();
  const routeId = Number(params.route);
  const [q, setQ] = useState('');
  const vehicles = useApi<MarshalVehicle[]>(`/marshal/vehicles?q=${encodeURIComponent(q.trim())}`);
  const [busy, setBusy] = useState(false);

  const arrived = (v: MarshalVehicle) => {
    const elsewhere = v.route_id !== routeId && v.route_name;
    Alert.alert(
      t('{plate} is at {place}?', { plate: v.plate, place: params.origin ?? '' }),
      elsewhere
        ? t('It is set to {route}; it will load on this route instead. The first passengers in the queue go on it.', { route: v.route_name ?? '' })
        : t('The first passengers in the queue go on it and are told to board.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Yes, it is here'),
          onPress: async () => {
            setBusy(true);
            try {
              await api('/marshal/cars/arrived', { method: 'POST', body: { vehicle_id: v.id, route_id: routeId } });
              router.back();
            } catch (err) {
              Alert.alert(t('Could not do that'), errorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen refreshing={vehicles.refreshing} onRefresh={vehicles.refresh}>
      <Field label={t('Number plate')} placeholder="KDA 123A" autoCapitalize="characters" autoCorrect={false} value={q} onChangeText={setQ} />
      {busy && <Loading />}
      {vehicles.error && <ErrorBox message={vehicles.error} onRetry={vehicles.reload} />}
      {vehicles.data?.length === 0 && <Empty text={t('No vehicle with that plate.')} />}
      {!!vehicles.data?.length && (
        <List>
          {vehicles.data.map((v) => (
            <ListRow
              key={v.id}
              icon="bus-outline"
              title={v.plate}
              subtitle={`${v.route_name ?? t('No route set')} · ${t('{n} seats', { n: v.seats })}`}
              right={v.busy === 'loading' ? t('Loading') : v.busy === 'departed' ? t('On a trip') : undefined}
              onPress={v.busy === 'loading' ? undefined : () => arrived(v)}
            />
          ))}
        </List>
      )}
      <Muted>{t('A car on a trip that arrives back is treated as having finished that trip.')}</Muted>
    </Screen>
  );
}
