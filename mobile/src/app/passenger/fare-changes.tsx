import { Text } from 'react-native';
import { Badge, Card, colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { FareChange } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Fare changes on the SACCO's routes: coming up, and those of the last 30 days. */
export default function FareChanges() {
  const { t } = useT();
  const changes = useApi<FareChange[]>('/passenger/fare-changes');
  if (changes.loading && !changes.data) return <Loading />;

  return (
    <Screen refreshing={changes.refreshing} onRefresh={changes.refresh}>
      <Muted>{t('Fares you already paid never change. A new fare applies to trips from its start date.')}</Muted>
      {changes.error && <ErrorBox message={changes.error} onRetry={changes.reload} />}
      {changes.data?.length === 0 && <Empty text={t('No fare changes in the last 30 days.')} />}
      {changes.data?.map((c) => {
        const coming = !c.applied_at;
        const up = c.new_app_fare > c.old_app_fare;
        return (
          <Card key={c.id}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>
              {c.route_name} · {t('to {place}', { place: c.stop_name })}
            </Text>
            <Badge text={coming ? t('Starts {when}', { when: dateTime(c.effective_from) }) : t('Since {when}', { when: dateTime(c.applied_at!) })} tone={coming ? 'warning' : 'neutral'} />
            <Text style={{ color: colors.text, marginTop: 6 }}>
              {t('Fare')} {kes(c.old_app_fare)} → <Text style={{ fontWeight: '700', color: up ? colors.danger : colors.primary }}>{kes(c.new_app_fare)}</Text>
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}
