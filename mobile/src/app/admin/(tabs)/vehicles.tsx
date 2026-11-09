import { router, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen } from '@/components/ui';
import type { Vehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';

// Filters from the office's Needs attention list.
const FILTER_TEXT: Record<string, string> = {
  no_route: 'Cars with no route',
  no_driver: 'Cars with no driver set',
  idle: 'Cars with no FarePay payments today',
};

export default function Vehicles() {
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const shown = filter && FILTER_TEXT[filter] ? filter : null;
  const { data, error, loading, refreshing, refresh, reload } = useApi<Vehicle[]>(`/admin/vehicles${shown ? `?filter=${shown}` : ''}`);
  if (loading && !data) return <Loading />;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {shown ? (
        <>
          <Notice>{`${FILTER_TEXT[shown]}: ${data?.length ?? 0}`}</Notice>
          <Button title="Show all vehicles" variant="secondary" onPress={() => router.setParams({ filter: '' })} />
        </>
      ) : (
        <Button title="Add vehicle" icon="add" onPress={() => router.push('/admin/vehicle-form')} />
      )}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.length === 0 && <Empty text="No vehicles yet. Add a route first, then the vehicle." />}
      {!!data?.length && (
        <List>
          {data.map((v) => (
            <ListRow
              key={v.id}
              icon="bus-outline"
              title={v.plate}
              subtitle={`Owner ${v.owner_name} · ${v.conductor_name ?? 'No conductor'} · ${v.driver_name ?? 'No driver'}`}
              right={v.route_name ?? 'No route'}
              rightSub={v.is_active ? undefined : <Badge text="Not in use" tone="danger" />}
              onPress={() => router.push(`/admin/vehicle/${v.id}`)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
