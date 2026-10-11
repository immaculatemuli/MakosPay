import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
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

/** Problem reports from passengers: reply and mark them in progress or resolved. */
export default function OfficeReports() {
  const [filter, setFilter] = useState<'open' | 'in_progress' | 'resolved'>('open');
  const reports = useApi<ProblemReport[]>(`/admin/reports?status=${filter}`);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const update = async (r: ProblemReport, status: ProblemReport['status']) => {
    setBusy(r.id);
    try {
      const note = notes[r.id]?.trim();
      await api(`/admin/reports/${r.id}`, { method: 'PATCH', body: { status, ...(note && { office_note: note }) } });
      setNotes((n) => ({ ...n, [r.id]: '' }));
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
          <Badge text={REPORT_STATUS_BADGE[r.status].text} tone={REPORT_STATUS_BADGE[r.status].tone} />
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
          <Text style={{ color: colors.text, marginVertical: 8 }}>{r.message}</Text>
          {r.office_note && (
            <Text style={{ color: colors.primaryDark, marginBottom: 8 }}>
              <Text style={{ fontWeight: '700' }}>Reply{r.handled_by_name ? ` (${r.handled_by_name})` : ''}: </Text>
              {r.office_note}
            </Text>
          )}
          {r.status !== 'resolved' && (
            <View>
              <TextInput
                placeholder="Reply to the passenger (optional)"
                placeholderTextColor="#9CA3AF"
                value={notes[r.id] ?? ''}
                onChangeText={(t) => setNotes((n) => ({ ...n, [r.id]: t }))}
                multiline
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 60, color: colors.text, marginBottom: 10, textAlignVertical: 'top' }}
              />
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
