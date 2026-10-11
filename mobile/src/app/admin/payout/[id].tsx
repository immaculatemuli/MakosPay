import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { PayoutBadge } from '@/components/PayoutBadge';
import { Button, Card, colors, ErrorBox, Field, KeyValue, List, ListRow, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, displayPhone, kes } from '@/lib/format';
import { sendByHandSteps } from '@/lib/payoutText';
import type { Payout, Trip } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** One payout to an owner: amount, status, the fares it covered, and recording the outcome by hand. */
export default function PayoutDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const payout = useApi<Payout & { trips: Trip[] }>(`/admin/payouts/${id}`);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (payout.loading && !payout.data) return <Loading />;
  const p = payout.data;
  if (!p) return <Screen><ErrorBox message={payout.error ?? 'Payout not found.'} onRetry={payout.reload} /></Screen>;
  const open = p.status === 'processing' || p.status === 'manual';

  const act = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/payouts/${p.id}/${path}`, { method: 'POST', body });
      setCode('');
      setReason('');
      await payout.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={payout.refreshing} onRefresh={payout.refresh}>
      <Card>
        <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text }}>{kes(p.amount)}</Text>
        <PayoutBadge status={p.status} />
        <KeyValue label="Owner" value={p.owner_name} />
        <KeyValue label="Owner's phone" value={displayPhone(p.owner_phone)} />
        <KeyValue label="Paid to" value={p.method === 'bank' ? `${p.bank_name} · paybill ${p.bank_paybill} · acc ${p.bank_account}` : 'M-Pesa'} />
        <KeyValue label="Fares" value={String(p.trip_count)} />
        <KeyValue label="Started" value={dateTime(p.created_at)} />
        <KeyValue label="By" value={p.created_by ? 'SACCO office' : 'Daily payout'} />
        {p.completed_at && <KeyValue label="Finished" value={dateTime(p.completed_at)} />}
        {p.reference && <KeyValue label="M-Pesa code" value={p.reference} />}
        {p.result_desc && <KeyValue label="Note" value={p.result_desc} />}
      </Card>

      {p.status === 'manual' && (
        <Notice>
          1. {sendByHandSteps(p, kes(p.amount))}
          {'\n'}2. Enter the M-Pesa code from the
          confirmation SMS below (e.g. SJK1A2B3C4) and tap Mark as paid.
        </Notice>
      )}
      {p.status === 'processing' && <Notice>Waiting for M-Pesa to confirm. Pull down to refresh. If it takes long, check the M-Pesa statement and record the result below.</Notice>}
      {p.status === 'failed' && (
        <>
          <Notice>These fares are owed to the owner again and will be in their next payout.</Notice>
          <Button
            title="Send it myself instead"
            icon="phone-portrait-outline"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                const next = await api<Payout>('/admin/payouts', { method: 'POST', body: { owner_phone: p.owner_phone, manual: true } });
                router.replace(`/admin/payout/${next.id}`);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          />
          {error && <ErrorBox message={error} />}
        </>
      )}

      {open && (
        <>
          <SectionTitle>Record the result</SectionTitle>
          <Field label="M-Pesa code" placeholder="e.g. SJK1A2B3C4" autoCapitalize="characters" value={code} onChangeText={setCode} />
          <Button title="Mark as paid" icon="checkmark-circle-outline" onPress={() => act('complete', { reference: code.trim() })} loading={busy} disabled={code.trim().length < 3} />
          <Field label="Or, if the money did not reach the owner: reason" value={reason} onChangeText={setReason} />
          <Button title="Mark as failed" variant="danger" onPress={() => act('fail', { reason: reason.trim() })} disabled={busy || reason.trim().length < 3} />
          {error && <ErrorBox message={error} />}
        </>
      )}

      <SectionTitle>Fares in this payout</SectionTitle>
      <List>
        {p.trips.map((t) => (
          <ListRow key={t.id} icon="bus-outline" title={`${t.plate} · to ${t.stop_name ?? t.route_name}`} subtitle={`${dateTime(t.created_at)} · ${t.passenger_name}`} right={kes(t.fare)} />
        ))}
      </List>
    </Screen>
  );
}
