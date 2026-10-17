import { router, type Href } from 'expo-router';
import { Text } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { REPORT_STATUS_BADGE } from '@/lib/reports';
import { REPORT_CATEGORY_LABEL, type ProblemReport } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { Conversation } from './Conversation';

/** Someone's own problem reports, each a conversation with the SACCO office they can keep writing on. */
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
          <Conversation
            report={r}
            side="reporter"
            placeholder={r.status === 'resolved' ? 'Still a problem? Write here to open it again' : 'Write more to the SACCO office'}
            onSend={async (message) => {
              await api(`${endpoint}/${r.id}/messages`, { method: 'POST', body: { message } });
              await reports.reload();
            }}
          />
        </Card>
      ))}
    </Screen>
  );
}
