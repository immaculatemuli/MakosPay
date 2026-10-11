import { router } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { kes, nairobiDate, time } from '@/lib/format';
import type { Run } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { Badge, Button, Chips, Empty, ErrorBox, List, ListRow, Loading, Screen } from '../ui';

const DAYS = [
  { value: 0, label: 'Today' },
  { value: -1, label: 'Yesterday' },
  { value: -2, label: '2 days ago' },
];

/** The vehicle's trips on a day, each with what was collected; tap one for the per-stop breakdown. */
export function CrewTrips() {
  const { user } = useAuth();
  const section = user?.role === 'driver' ? 'driver' : 'conductor';
  const [day, setDay] = useState(0);
  const runs = useApi<Run[]>(`/crew/runs?date=${nairobiDate(day)}`);
  if (runs.loading && !runs.data) return <Loading />;

  return (
    <Screen refreshing={runs.refreshing} onRefresh={runs.refresh}>
      <Chips options={DAYS} value={day} onChange={setDay} />
      {runs.error && <ErrorBox message={runs.error} onRetry={runs.reload} />}
      {runs.data?.length === 0 && <Empty text="No trips on this day. Start one from the Payments tab." />}
      {!!runs.data?.length && (
        <List>
          {runs.data.map((r) => (
            <ListRow
              key={r.id}
              icon={r.ended_at ? 'flag-outline' : 'navigate-outline'}
              title={`${time(r.started_at)}${r.ended_at ? ` – ${time(r.ended_at)}` : ' – now'}${r.route_name ? ` · ${r.route_name}` : ''}`}
              subtitle={`${r.payments} payment${r.payments === 1 ? '' : 's'} · started by ${r.started_by_name}`}
              right={kes(r.total)}
              rightSub={r.ended_at ? undefined : <Badge text="In progress" tone="success" />}
              onPress={() => router.push(`/${section}/run/${r.id}`)}
            />
          ))}
        </List>
      )}
      <Button title="Report a problem" variant="secondary" icon="chatbox-ellipses-outline" onPress={() => router.push(`/${section}/report`)} />
    </Screen>
  );
}
