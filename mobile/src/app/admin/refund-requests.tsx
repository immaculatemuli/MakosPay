import { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Field, KeyValue, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, displayPhone, kes } from '@/lib/format';
import type { RefundRequest } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** One request waiting for the office: refund it, or say why not (the crew see the note). */
function Waiting({ r, onDone }: { r: RefundRequest; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (path: 'approve' | 'decline', body?: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/refund-requests/${r.id}/${path}`, { method: 'POST', body });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{kes(r.fare)}</Text>
      <KeyValue label="Reason" value={r.reason} />
      <KeyValue label="Asked by" value={`${r.requested_by_name} (${r.requested_by_role}), ${dateTime(r.created_at)}`} />
      <KeyValue label="Car" value={`${r.plate} · ${r.route_name}`} />
      <KeyValue label="Passenger" value={`${r.passenger_name} · ${displayPhone(r.passenger_phone)}`} />
      <KeyValue label="Paid" value={`${dateTime(r.paid_at)} · ticket ${r.ticket_code}${r.stop_name ? ` · to ${r.stop_name}` : ''}`} />
      <Muted>
        {r.free_ride
          ? 'A free ride: refunding gives the passenger their free ride back.'
          : r.no_app
            ? `Paid without the app: the ${kes(r.fare)} goes back to their M-Pesa.`
            : `The ${kes(r.fare)} goes back to the passenger's FarePay wallet.`}
      </Muted>
      <Button title="Refund the passenger" icon="return-down-back-outline" onPress={() => act('approve')} loading={busy} />
      <Field label="Or say no: why (the crew see this)" value={note} onChangeText={setNote} maxLength={200} />
      <Button title="Don't refund" variant="danger" onPress={() => act('decline', { note: note.trim() })} disabled={busy || note.trim().length < 3} />
      {error && <ErrorBox message={error} />}
    </Card>
  );
}

/** "Paid by mistake" requests from conductors and drivers: waiting ones first, then the latest decided. */
export default function RefundRequests() {
  const waiting = useApi<{ requests: RefundRequest[] }>('/admin/refund-requests');
  const all = useApi<{ requests: RefundRequest[] }>('/admin/refund-requests?status=all');
  if (waiting.loading && !waiting.data) return <Loading />;
  const reload = () => {
    void waiting.reload();
    void all.reload();
  };
  const decided = (all.data?.requests ?? []).filter((r) => r.status !== 'waiting');

  return (
    <Screen
      refreshing={waiting.refreshing || all.refreshing}
      onRefresh={() => {
        waiting.refresh();
        all.refresh();
      }}
    >
      {waiting.error && <ErrorBox message={waiting.error} onRetry={reload} />}
      <SectionTitle>Waiting</SectionTitle>
      {waiting.data?.requests.length === 0 ? <Empty text="Nothing waiting." /> : waiting.data?.requests.map((r) => <Waiting key={r.id} r={r} onDone={reload} />)}

      <SectionTitle>Decided</SectionTitle>
      {decided.length === 0 ? (
        <Empty text="None yet." />
      ) : (
        <List>
          {decided.map((r) => (
            <ListRow
              key={r.id}
              icon="return-down-back-outline"
              title={`${r.plate} · ${kes(r.fare)} · ${r.ticket_code}`}
              subtitle={[r.reason, `${r.requested_by_name}`, r.decided_at && `${r.decided_by_name ?? 'Office'} ${dateTime(r.decided_at)}`, r.office_note].filter(Boolean).join(' · ')}
              rightSub={<Badge text={r.status === 'refunded' ? 'Refunded' : 'Refused'} tone={r.status === 'refunded' ? 'success' : 'neutral'} />}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
