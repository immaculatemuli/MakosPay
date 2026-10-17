import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Empty, ErrorBox, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { ConductorVehicle, PublicRoute } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** The vehicle is on a different route today: passengers who scan after this pay that route's fares. */
export default function ChangeRoute() {
  const { t } = useT();
  const routes = useApi<PublicRoute[]>('/crew/routes');
  const vehicle = useApi<ConductorVehicle>('/crew/vehicle');
  const [busy, setBusy] = useState(false);
  if ((routes.loading && !routes.data) || (vehicle.loading && !vehicle.data)) return <Loading />;
  const currentId = vehicle.data?.route?.id;

  const choose = (r: PublicRoute) => {
    if (r.id === currentId || busy) return router.back();
    Alert.alert(t('Switch to {route}?', { route: r.name }), t('Passengers who scan from now on will pay this route’s fares.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Switch'),
        onPress: async () => {
          setBusy(true);
          try {
            await api('/crew/vehicle/route', { method: 'PUT', body: { route_id: r.id } });
            router.back();
          } catch (err) {
            Alert.alert(t('Could not change route'), errorMessage(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen refreshing={routes.refreshing} onRefresh={routes.refresh}>
      {routes.error && <ErrorBox message={routes.error} onRetry={routes.reload} />}
      <Muted>{t('Choose the route your vehicle is on now.')}</Muted>
      {routes.data?.length === 0 && <Empty text={t('No routes yet. Ask the SACCO office to add one.')} />}
      {!!routes.data?.length && (
        <List>
          {routes.data.map((r) => {
            const fares = r.stops.map((s) => s.app_fare);
            return (
              <ListRow
                key={r.id}
                icon={r.id === currentId ? 'checkmark-circle' : 'map-outline'}
                title={r.name}
                subtitle={`${t('From {place}', { place: r.origin })} · ${r.stops.map((s) => s.name).join(', ')}`}
                right={fares.length ? kes(Math.min(...fares)) : ''}
                onPress={() => choose(r)}
              />
            );
          })}
        </List>
      )}
    </Screen>
  );
}
