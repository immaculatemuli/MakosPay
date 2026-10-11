import { router } from 'expo-router';
import { Text } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { dateTime, kes, signedKes } from '@/lib/format';
import type { MpesaPayment, WalletTx } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { usePaged } from '@/lib/usePaged';

const LABEL: Record<WalletTx['type'], string> = {
  topup: 'M-Pesa',
  fare: 'Fare',
  refund: 'Refund',
  test_credit: 'Test credit',
  withdrawal: 'Withdrawal to M-Pesa',
  withdrawal_reversal: 'Withdrawal not sent',
};

type Attempt = Pick<MpesaPayment, 'id' | 'amount' | 'purpose' | 'status' | 'result_desc'> & { created_at: string };

/** Balance, Add money, M-Pesa payments still waiting or failed, and every movement in and out of the wallet. */
export default function Wallet() {
  const wallet = useApi<{ balance: number }>('/passenger/wallet');
  const attempts = useApi<Attempt[]>('/passenger/mpesa');
  const txs = usePaged<WalletTx>('/passenger/wallet/transactions');
  if (txs.loading && wallet.loading) return <Loading />;

  const refresh = () => {
    wallet.refresh();
    attempts.refresh();
    txs.refresh();
  };

  return (
    <Screen refreshing={txs.refreshing || wallet.refreshing} onRefresh={refresh}>
      <Card style={{ alignItems: 'center', paddingVertical: 22 }}>
        <Text style={{ color: colors.muted }}>Available balance</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', color: colors.text }}>{wallet.data ? kes(wallet.data.balance) : '—'}</Text>
      </Card>
      <Button title="Add money with M-Pesa" icon="add-circle-outline" onPress={() => router.push('/passenger/topup')} />
      <Button title="Withdraw to M-Pesa" variant="secondary" icon="arrow-up-circle-outline" onPress={() => router.push('/passenger/withdraw')} />

      {!!attempts.data?.length && (
        <>
          <SectionTitle>Waiting or not completed</SectionTitle>
          <List>
            {attempts.data.map((a) => (
              <ListRow
                key={a.id}
                icon={a.status === 'failed' ? 'close-circle-outline' : 'hourglass-outline'}
                title={`${a.purpose === 'fare' ? 'Fare' : 'Top-up'} ${kes(a.amount)}`}
                subtitle={
                  a.status === 'failed'
                    ? `${dateTime(a.created_at)} · ${a.result_desc ?? 'Not completed'}. No money was taken.`
                    : `${dateTime(a.created_at)} · Waiting for M-Pesa. If you entered your PIN it will be added shortly.`
                }
                rightSub={a.status === 'failed' ? <Badge text="Failed" tone="danger" /> : <Badge text="Pending" tone="warning" />}
              />
            ))}
          </List>
        </>
      )}

      <SectionTitle>History</SectionTitle>
      {txs.error && <ErrorBox message={txs.error} onRetry={txs.reload} />}
      {txs.items.length === 0 && !txs.error && <Empty text="No wallet activity yet." />}
      {txs.items.length > 0 && (
        <List>
          {txs.items.map((t) => (
            <ListRow
              key={t.id}
              icon={t.amount > 0 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
              title={t.description ?? LABEL[t.type]}
              subtitle={`${dateTime(t.created_at)}${t.reference ? ` · Ref ${t.reference}` : ''}`}
              right={signedKes(t.amount)}
              rightSub={<Badge text={t.type === 'test_credit' ? 'Test credit (not real)' : `Balance ${kes(t.balance_after)}`} tone={t.type === 'test_credit' ? 'warning' : 'neutral'} />}
            />
          ))}
        </List>
      )}
      {txs.hasMore && <Button title="Load more" variant="secondary" onPress={txs.loadMore} loading={txs.loadingMore} />}
      <Muted center>Every entry here was confirmed by the server. Your balance can only change through these.</Muted>
    </Screen>
  );
}
