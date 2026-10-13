import { Text } from 'react-native';
import { Badge, Card, colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { FareChange } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Fare changes on the SACCO's routes: coming up, and those of the last 30 days. */
export default function FareChanges() {
  const changes = useApi<FareChange[]>('/passenger/fare-changes');
  if (changes.loading && !changes.data) return <Loading />;

  return (
    <Screen refreshing={changes.refreshing} onRefresh={changes.refresh}>
      <Muted>Fares you already paid never change. A new fare applies to trips from its start date.</Muted>
      {changes.error && <ErrorBox message={changes.error} onRetry={changes.reload} />}
      {changes.data?.length === 0 && <Empty text="No fare changes in the last 30 days." />}
      {changes.data?.map((c) => {
        const coming = !c.applied_at;
        const up = c.new_app_fare > c.old_app_fare;
        return (
          <Card key={c.id}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>
              {c.route_name} · to {c.stop_name}
            </Text>
            <Badge text={coming ? `Starts ${dateTime(c.effective_from)}` : `Since ${dateTime(c.applied_at!)}`} tone={coming ? 'warning' : 'neutral'} />
            <Text style={{ color: colors.text, marginTop: 6 }}>
              Fare {kes(c.old_app_fare)} → <Text style={{ fontWeight: '700', color: up ? colors.danger : colors.primary }}>{kes(c.new_app_fare)}</Text>
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}
