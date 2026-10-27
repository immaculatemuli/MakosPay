import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { RouteCard, routeEnds, routeMatches, RouteSearch } from '@/components/RouteCard';
import { Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
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
  const [query, setQuery] = useState('');
  if ((routes.loading && !routes.data) || (vehicle.loading && !vehicle.data)) return <Loading />;
  const currentId = vehicle.data?.route?.id;
  const shown = routes.data?.filter((r) => routeMatches(r, query));

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
      <View style={{ height: 10 }} />
      {!!routes.data?.length && <RouteSearch value={query} onChangeText={setQuery} />}
      {!!routes.data?.length && shown?.length === 0 && <Empty text={t('No route has that stage.')} />}
      {shown?.map((r) => {
        const fares = r.stops.map((s) => s.app_fare);
        return (
          <RouteCard
            key={r.id}
            title={r.name}
            subtitle={`${routeEnds(r)} · ${r.stops.map((s) => s.name).join(', ')}`}
            right={fares.length ? kes(Math.min(...fares)) : ''}
            icon={r.id === currentId ? 'checkmark-circle' : 'chevron-forward'}
            onPress={() => choose(r)}
          />
        );
      })}
    </Screen>
  );
}
