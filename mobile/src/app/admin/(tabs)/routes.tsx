import { router } from 'expo-router';
import { useState } from 'react';
import { RouteCard, routeEnds, routeMatches, RouteSearch } from '@/components/RouteCard';
import { Badge, Button, Empty, ErrorBox, Loading, Screen } from '@/components/ui';
import { kes } from '@/lib/format';
import type { Route } from '@/lib/types';
import { useApi } from '@/lib/useApi';

export default function Routes() {
  const { data, error, loading, refreshing, refresh, reload } = useApi<Route[]>('/admin/routes');
  const [query, setQuery] = useState('');
  if (loading && !data) return <Loading />;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="Add route" icon="add" onPress={() => router.push('/admin/route-form')} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.length === 0 && <Empty text="No routes yet. Add your first route and its drop-off stops." />}
      {!!data?.length && <RouteSearch value={query} onChangeText={setQuery} />}
      {!!data?.length && !data.some((r) => routeMatches(r, query)) && <Empty text="No route has that stage." />}
      {data
        ?.filter((r) => routeMatches(r, query))
        .map((r) => {
          const { stops } = r;
          const fares = stops.map((s) => s.app_fare);
          const from = fares.length ? Math.min(...fares) : 0;
          const to = fares.length ? Math.max(...fares) : 0;
          return (
            <RouteCard
              key={r.id}
              title={r.name}
              subtitle={`${routeEnds(r)} · ${stops.map((s) => s.name).join(', ') || 'No stops'}`}
              right={from === to ? kes(from) : `${kes(from)}–${to}`}
              rightSub={r.is_active ? <Badge text={`${stops.length} stop${stops.length === 1 ? '' : 's'}`} tone="success" /> : <Badge text="Not in use" tone="danger" />}
              onPress={() => router.push({ pathname: '/admin/route-form', params: { id: r.id } })}
            />
          );
        })}
    </Screen>
  );
}
