import { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Field, KeyValue, List, ListRow, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, displayPhone, kes } from '@/lib/format';
import type { Withdrawal } from '@/lib/types';
import { useApi } from '@/lib/useApi';

interface Queue {
  automatic: boolean;
  open: Withdrawal[];
  recent: Withdrawal[];
}

/** One withdrawal still to be finished: send the money, then record the M-Pesa code (or mark it failed). */
function OpenWithdrawal({ w, onDone }: { w: Withdrawal; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (path: 'complete' | 'fail', body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/withdrawals/${w.id}/${path}`, { method: 'POST', body });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{kes(w.amount)}</Text>
      <KeyValue label="Passenger" value={w.passenger_name ?? ''} />
      <KeyValue label="Send to M-Pesa" value={displayPhone(w.phone)} />
      <KeyValue label="Asked" value={dateTime(w.created_at)} />
      {w.result_desc && <KeyValue label="Note" value={w.result_desc} />}
      <Muted>
        {w.status === 'manual'
          ? `Send ${kes(w.amount)} to ${displayPhone(w.phone)} from the SACCO's M-Pesa, then enter the code from the confirmation SMS.`
          : 'Sent to M-Pesa, waiting for its answer. If it takes long, check the M-Pesa statement and record the result here.'}
      </Muted>
      <Field label="M-Pesa code" placeholder="e.g. SJK1A2B3C4" autoCapitalize="characters" value={code} onChangeText={setCode} />
      <Button title="Mark as sent" icon="checkmark-circle-outline" onPress={() => act('complete', { reference: code.trim() })} loading={busy} disabled={code.trim().length < 3} />
      <Field label="Or, if it could not be sent: reason (the money goes back to their wallet)" value={reason} onChangeText={setReason} />
      <Button title="Mark as not sent" variant="danger" onPress={() => act('fail', { reason: reason.trim() })} disabled={busy || reason.trim().length < 3} />
      {error && <ErrorBox message={error} />}
    </Card>
  );
}

/** Passengers' wallet withdrawals: the ones waiting for the office first, then the latest finished. */
export default function Withdrawals() {
  const queue = useApi<Queue>('/admin/withdrawals');
  if (queue.loading && !queue.data) return <Loading />;
  const q = queue.data;

  return (
    <Screen refreshing={queue.refreshing} onRefresh={queue.refresh}>
      {queue.error && <ErrorBox message={queue.error} onRetry={queue.reload} />}
      {q && (
        <>
          <Notice tone={q.automatic ? 'success' : 'warning'}>
            {q.automatic
              ? 'Withdrawals are sent by M-Pesa automatically. Only ones M-Pesa did not answer need you.'
              : "Automatic M-Pesa payments aren't set up, so the office sends each withdrawal itself and records the M-Pesa code."}
          </Notice>
          <SectionTitle>Waiting</SectionTitle>
          {q.open.length === 0 ? <Empty text="Nothing waiting." /> : q.open.map((w) => <OpenWithdrawal key={w.id} w={w} onDone={queue.reload} />)}

          <SectionTitle>Recent</SectionTitle>
          {q.recent.length === 0 ? (
            <Empty text="No withdrawals yet." />
          ) : (
            <List>
              {q.recent.map((w) => (
                <ListRow
                  key={w.id}
                  icon="arrow-up-circle-outline"
                  title={`${w.passenger_name} · ${kes(w.amount)}`}
                  subtitle={`${dateTime(w.created_at)} · ${displayPhone(w.phone)}${w.reference ? ` · ${w.reference}` : ''}${w.status === 'failed' && w.result_desc ? ` · ${w.result_desc}` : ''}`}
                  rightSub={<Badge text={w.status === 'completed' ? 'Sent' : 'Not sent'} tone={w.status === 'completed' ? 'success' : 'danger'} />}
                />
              ))}
            </List>
          )}
        </>
      )}
    </Screen>
  );
}
