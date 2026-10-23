import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { PayoutBadge } from '@/components/PayoutBadge';
import { Button, Card, colors, Empty, ErrorBox, List, ListRow, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes } from '@/lib/format';
import { payoutDestination, sendByHandSteps } from '@/lib/payoutText';
import type { OwnerOwed, Payout } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** What each owner is owed, paying them, and every payout made. */
export default function Payouts() {
  const owed = useApi<{ owners: OwnerOwed[]; automatic: boolean; daily_at: string }>('/admin/payouts/owed');
  const history = useApi<Payout[]>('/admin/payouts');
  const [busy, setBusy] = useState<string | null>(null);

  if (owed.loading && !owed.data) return <Loading />;
  const o = owed.data;
  const totalOwed = o?.owners.reduce((sum, x) => sum + x.amount, 0) ?? 0;

  const reload = async () => {
    await Promise.all([owed.reload(), history.reload()]);
  };

  const run = async (key: string, request: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await request();
      await reload();
    } catch (err) {
      Alert.alert('Could not pay', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const payOne = (owner: OwnerOwed) =>
    Alert.alert(
      `Pay ${owner.owner_name} ${kes(owner.amount)}?`,
      o?.automatic
        ? `The money is sent now to ${payoutDestination(owner)}.`
        : `${sendByHandSteps(owner, kes(owner.amount))} Then record the M-Pesa code on the payout.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pay now', onPress: () => run(owner.owner_phone, () => api('/admin/payouts', { method: 'POST', body: { owner_phone: owner.owner_phone } })) },
      ],
    );

  // The office sends the money from its own M-Pesa, then records the M-Pesa code on the payout screen.
  const sendMyself = (owner: OwnerOwed) =>
    Alert.alert(
      `Send ${kes(owner.amount)} yourself?`,
      `${sendByHandSteps(owner, kes(owner.amount))} Next, you'll enter the M-Pesa code from the confirmation SMS.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () =>
            run(owner.owner_phone, async () => {
              const payout = await api<Payout>('/admin/payouts', { method: 'POST', body: { owner_phone: owner.owner_phone, manual: true } });
              router.push(`/admin/payout/${payout.id}`);
            }),
        },
      ],
    );

  const payAll = () =>
    Alert.alert(`Pay everyone ${kes(totalOwed)}?`, `Each owner gets everything they are owed now, instead of waiting for ${o?.daily_at}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay everyone', onPress: () => run('all', () => api('/admin/payouts/run', { method: 'POST' })) },
    ]);

  return (
    <Screen refreshing={owed.refreshing || history.refreshing} onRefresh={() => void reload()}>
      {owed.error && <ErrorBox message={owed.error} onRetry={owed.reload} />}
      {o && (
        <Card>
          <Text style={styles.label}>Owed to owners now</Text>
          <Text style={styles.total}>{kes(totalOwed)}</Text>
          <Muted>
            {o.automatic
              ? `Every day at ${o.daily_at}, each owner is sent their fares to M-Pesa automatically.`
              : `Automatic M-Pesa payouts are not set up. At ${o.daily_at} each day, payouts are prepared for you to send yourself.`}
          </Muted>
        </Card>
      )}
      {o && !o.automatic && <Notice>Send each payout’s amount to the owner’s M-Pesa, then open the payout and enter the M-Pesa code.</Notice>}

      <SectionTitle>Owed now</SectionTitle>
      {o?.owners.length === 0 && <Empty text="Nothing owed. Every fare has been paid to its owner." />}
      {o?.owners.map((owner) => (
        <Card key={owner.owner_phone}>
          <View style={styles.ownerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ownerName}>{owner.owner_name}</Text>
              <Muted>
                {payoutDestination(owner)} · {owner.plates.join(', ')}
              </Muted>
              <Muted>
                {owner.trip_count} fare{owner.trip_count === 1 ? '' : 's'}
                {owner.deducted > 0 ? ` · ${kes(owner.fares)} minus ${kes(owner.deducted)} refunded after an earlier payout` : ''}
              </Muted>
            </View>
            <Text style={styles.amount}>{kes(owner.amount)}</Text>
          </View>
          <View style={{ height: 10 }} />
          {o?.automatic && (
            <Button title="Pay now by M-Pesa" icon="send-outline" onPress={() => payOne(owner)} loading={busy === owner.owner_phone} disabled={busy !== null} />
          )}
          <Button
            title="I'll send it myself"
            variant={o?.automatic ? 'secondary' : 'primary'}
            icon="phone-portrait-outline"
            onPress={() => sendMyself(owner)}
            disabled={busy !== null}
          />
        </Card>
      ))}
      {o?.automatic && (o?.owners.length ?? 0) > 1 && <Button title={`Pay everyone ${kes(totalOwed)}`} variant="secondary" onPress={payAll} loading={busy === 'all'} disabled={busy !== null} />}

      <SectionTitle>Payout history</SectionTitle>
      {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}
      {history.data?.length === 0 && <Empty text="No payouts yet." />}
      {!!history.data?.length && (
        <List>
          {history.data.map((p) => (
            <ListRow
              key={p.id}
              icon="send-outline"
              title={p.owner_name}
              subtitle={`${dateTime(p.created_at)} · ${p.created_by ? 'Paid by office' : 'Daily payout'}`}
              right={kes(p.amount)}
              rightSub={<PayoutBadge status={p.status} />}
              onPress={() => router.push(`/admin/payout/${p.id}`)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 14 },
  total: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 4 },
  ownerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  ownerName: { fontSize: 17, fontWeight: '700', color: colors.text },
  amount: { fontSize: 20, fontWeight: '800', color: colors.text },
});
