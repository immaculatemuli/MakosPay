import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Screen } from '@/components/ui';
import { dateTime, kes, signedKes } from '@/lib/format';
import type { WalletTx } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

const LABEL: Record<WalletTx['type'], string> = {
  topup: 'M-Pesa',
  fare: 'Fare',
  refund: 'Refund',
  test_credit: 'Test credit',
};

/** Every movement of money in and out of the wallet. */
export default function WalletHistory() {
  const txs = usePaged<WalletTx>('/passenger/wallet/transactions');
  if (txs.loading) return <Loading />;

  return (
    <Screen refreshing={txs.refreshing} onRefresh={txs.refresh}>
      {txs.error && <ErrorBox message={txs.error} onRetry={txs.reload} />}
      {txs.items.length === 0 && !txs.error && <Empty text="No wallet activity yet." />}
      {txs.items.length > 0 && (
        <List>
          {txs.items.map((t) => (
            <ListRow
              key={t.id}
              icon={t.amount > 0 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
              title={t.description ?? LABEL[t.type]}
              subtitle={`${dateTime(t.created_at)}${t.reference ? ` · ${t.reference}` : ''}`}
              right={signedKes(t.amount)}
              rightSub={<Badge text={`Balance ${kes(t.balance_after)}`} tone={t.type === 'test_credit' ? 'warning' : 'neutral'} />}
            />
          ))}
        </List>
      )}
      {txs.hasMore && <Button title="Load more" variant="secondary" onPress={txs.loadMore} loading={txs.loadingMore} />}
    </Screen>
  );
}
