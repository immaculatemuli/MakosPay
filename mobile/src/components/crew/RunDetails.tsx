import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { dateTime, kes } from '@/lib/format';
import type { Run } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { Card, colors, Empty, ErrorBox, KeyValue, List, ListRow, Loading, Screen, SectionTitle } from '../ui';

/** One trip's collection summary, with a breakdown per drop-off stop. `base` is '/crew' or '/admin'. */
export function RunDetails({ base }: { base: '/crew' | '/admin' }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const run = useApi<Run>(`${base}/runs/${id}`);
  if (run.loading && !run.data) return <Loading />;
  const r = run.data;
  if (!r) return <Screen><ErrorBox message={run.error ?? 'Trip not found.'} onRetry={run.reload} /></Screen>;

  return (
    <Screen refreshing={run.refreshing} onRefresh={run.refresh}>
      <Card>
        <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text }}>{kes(r.total)}</Text>
        <Text style={{ color: colors.muted }}>
          {r.payments} payment{r.payments === 1 ? '' : 's'} on this trip
        </Text>
        <KeyValue label="Route" value={r.route_name ?? '—'} />
        <KeyValue label="Started" value={`${dateTime(r.started_at)} by ${r.started_by_name}`} />
        <KeyValue label="Ended" value={r.ended_at ? `${dateTime(r.ended_at)} by ${r.ended_by_name ?? '—'}` : 'Still in progress'} />
      </Card>
      <SectionTitle>By drop-off</SectionTitle>
      {!r.by_stop?.length && <Empty text="No payments on this trip." />}
      {!!r.by_stop?.length && (
        <List>
          {r.by_stop.map((s) => (
            <ListRow key={s.stop_name} icon="location-outline" title={s.stop_name} subtitle={`${s.payments} payment${s.payments === 1 ? '' : 's'}`} right={kes(s.total)} />
          ))}
        </List>
      )}
    </Screen>
  );
}
