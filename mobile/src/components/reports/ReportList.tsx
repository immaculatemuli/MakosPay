import { router, type Href } from 'expo-router';
import { Text } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { REPORT_STATUS_BADGE } from '@/lib/reports';
import { REPORT_CATEGORY_LABEL, type ProblemReport } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Someone's own problem reports and the SACCO office's replies. */
export function ReportList({ endpoint, newHref }: { endpoint: string; newHref: Href }) {
  const reports = useApi<ProblemReport[]>(endpoint);
  if (reports.loading && !reports.data) return <Loading />;

  return (
    <Screen refreshing={reports.refreshing} onRefresh={reports.refresh}>
      <Button title="Report a problem" icon="add" onPress={() => router.push(newHref)} />
      {reports.error && <ErrorBox message={reports.error} onRetry={reports.reload} />}
      {reports.data?.length === 0 && <Empty text="You haven't reported any problems." />}
      {reports.data?.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{REPORT_CATEGORY_LABEL[r.category]}</Text>
          <Badge text={REPORT_STATUS_BADGE[r.status].text} tone={REPORT_STATUS_BADGE[r.status].tone} />
          <Muted>
            {dateTime(r.created_at)}
            {r.ticket_code ? ` · ticket ${r.ticket_code}${r.plate ? ` on ${r.plate}` : ''}` : ''}
          </Muted>
          <Text style={{ color: colors.text, marginTop: 6 }}>{r.message}</Text>
          {r.office_note && (
            <Text style={{ color: colors.primaryDark, marginTop: 8 }}>
              <Text style={{ fontWeight: '700' }}>SACCO office: </Text>
              {r.office_note}
            </Text>
          )}
        </Card>
      ))}
    </Screen>
  );
}
