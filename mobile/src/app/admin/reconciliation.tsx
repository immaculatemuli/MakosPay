import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import { Card, colors, ErrorBox, KeyValue, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { Reconciliation } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Money check: does everything recorded in FarePay add up? */
export default function MoneyCheck() {
  const r = useApi<Reconciliation>('/admin/reconciliation');
  if (r.loading && !r.data) return <Loading />;
  const d = r.data;

  return (
    <Screen refreshing={r.refreshing} onRefresh={r.refresh}>
      {r.error && <ErrorBox message={r.error} onRetry={r.reload} />}
      {d && (
        <>
          {!d.totals.real_money && <Notice>Test mode: these amounts are test transactions, not real money.</Notice>}
          <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
            <Ionicons name={d.all_ok ? 'checkmark-circle' : 'alert-circle'} size={52} color={d.all_ok ? colors.primary : colors.danger} />
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 6 }}>{d.all_ok ? 'Everything adds up' : 'Something does not add up'}</Text>
            <Muted>Checked {dateTime(d.checked_at)}</Muted>
          </Card>

          <SectionTitle>Checks</SectionTitle>
          {d.checks.map((c) => (
            <Card key={c.name}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={c.ok ? 'checkmark-circle' : 'close-circle'} size={20} color={c.ok ? colors.primary : colors.danger} />
                <Text style={{ flex: 1, color: colors.text, fontWeight: '600' }}>{c.name}</Text>
              </View>
              {c.detail && <Text style={{ color: colors.danger, marginTop: 6 }}>{c.detail}</Text>}
            </Card>
          ))}

          <SectionTitle>Totals</SectionTitle>
          <Card>
            <KeyValue label="Received by M-Pesa" value={kes(d.totals.mpesa_collected)} />
            {d.totals.test_credit > 0 && <KeyValue label="Test credit (not real)" value={kes(d.totals.test_credit)} />}
            <KeyValue label="Refunds to wallets" value={kes(d.totals.refunds_to_wallets)} />
            <KeyValue label="Fares paid" value={kes(d.totals.fares_paid)} />
            <KeyValue label="Left in passenger wallets" value={kes(d.totals.wallet_balances)} />
            <KeyValue label="Paid out to owners" value={kes(d.totals.paid_out_to_owners)} />
            <KeyValue label="Being paid out" value={kes(d.totals.being_paid_out)} />
            <KeyValue label="Still owed to owners" value={kes(d.totals.owed_to_owners)} />
            {d.totals.refunds_to_take_back > 0 && <KeyValue label="Refunds to take off next payouts" value={kes(d.totals.refunds_to_take_back)} />}
            {d.totals.mpesa_pending > 0 && <KeyValue label="M-Pesa waiting for confirmation" value={kes(d.totals.mpesa_pending)} />}
          </Card>
          <Muted>
            Money left in passenger wallets plus money owed to owners must always be covered by what is actually held in the business M-Pesa account. Compare
            with your M-Pesa statement.
          </Muted>
        </>
      )}
    </Screen>
  );
}
