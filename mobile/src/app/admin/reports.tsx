import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Conversation } from '@/components/reports/Conversation';
import { Badge, Button, Card, Chips, colors, Empty, ErrorBox, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, displayPhone, kes } from '@/lib/format';
import { REPORT_STATUS_BADGE } from '@/lib/reports';
import { REPORT_CATEGORY_LABEL, ROLE_LABEL, type ProblemReport } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const FILTERS = [
  { value: 'open' as const, label: 'Open' },
  { value: 'in_progress' as const, label: 'Being looked at' },
  { value: 'resolved' as const, label: 'Resolved' },
];

/** Problem reports from passengers and crew: write back and forth with them, mark them in progress or resolved. */
export default function OfficeReports() {
  const [filter, setFilter] = useState<'open' | 'in_progress' | 'resolved'>('open');
  const reports = useApi<ProblemReport[]>(`/admin/reports?status=${filter}`);
  const [busy, setBusy] = useState<number | null>(null);

  const update = async (r: ProblemReport, status: ProblemReport['status']) => {
    setBusy(r.id);
    try {
      await api(`/admin/reports/${r.id}`, { method: 'PATCH', body: { status } });
      await reports.reload();
    } catch (err) {
      Alert.alert('Could not update', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen refreshing={reports.refreshing} onRefresh={reports.refresh}>
      <Chips options={FILTERS} value={filter} onChange={setFilter} />
      {reports.loading && !reports.data && <Loading />}
      {reports.error && <ErrorBox message={reports.error} onRetry={reports.reload} />}
      {reports.data?.length === 0 && <Empty text="Nothing here." />}
      {reports.data?.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{REPORT_CATEGORY_LABEL[r.category]}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Badge text={REPORT_STATUS_BADGE[r.status].text} tone={REPORT_STATUS_BADGE[r.status].tone} />
            {!!r.has_new && <Badge text={r.messages.length ? 'New reply' : 'New'} tone="danger" />}
          </View>
          <Muted>
            {r.reporter_name}
            {r.reporter_role ? ` (${ROLE_LABEL[r.reporter_role]})` : ''} · {displayPhone(r.reporter_phone ?? null)} · {dateTime(r.created_at)}
          </Muted>
          {r.ticket_code && (
            <Muted>
              Payment: ticket {r.ticket_code}
              {r.plate ? ` on ${r.plate}` : ''}
              {r.fare != null ? `, ${kes(r.fare)}` : ''}
            </Muted>
          )}
          <Conversation
            report={r}
            side="office"
            photosAt="/admin/reports"
            placeholder={`Write to ${r.reporter_name}`}
            onSend={async (message) => {
              await api(`/admin/reports/${r.id}/messages`, { method: 'POST', body: { message } });
              await reports.reload();
            }}
          />
          {r.status !== 'resolved' && (
            <View>
              {r.status === 'open' && (
                <Button title="Mark as being looked at" variant="secondary" onPress={() => update(r, 'in_progress')} loading={busy === r.id} />
              )}
              <Button title="Mark as resolved" icon="checkmark-circle-outline" onPress={() => update(r, 'resolved')} loading={busy === r.id} />
              {r.ticket_code && <Muted>To refund the fare, find the payment under Payments and tap it.</Muted>}
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
