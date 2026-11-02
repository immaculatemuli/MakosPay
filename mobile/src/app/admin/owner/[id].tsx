import { router, useLocalSearchParams } from 'expo-router';
import { Badge, Button, Card, ErrorBox, KeyValue, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { dateTime, displayPhone, kes } from '@/lib/format';
import type { OwnerDetail } from '@/lib/owners';
import { useApi } from '@/lib/useApi';

/** One owner: their cars with today's takings, tonight's payout, their payouts, and their details. */
export default function OwnerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useApi<OwnerDetail>(`/admin/owners/${id}`);
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) {
    return (
      <Screen>
        <ErrorBox message={d.error ?? 'Owner not found'} onRetry={d.reload} />
      </Screen>
    );
  }
  const { owner: o, vehicles, owed, refunds_to_take_back: refunds, payouts } = d.data;
  const today = vehicles.reduce((n, v) => n + v.today_total, 0);

  return (
    <Screen refreshing={d.refreshing} onRefresh={d.refresh}>
      <Card>
        <KeyValue label="Owner" value={o.name} />
        <KeyValue label="Phone" value={displayPhone(o.phone)} />
        {!!o.id_number && <KeyValue label="ID number" value={o.id_number} />}
        <KeyValue label="Paid to" value={o.payout_method === 'bank' ? `${o.bank_name} (paybill ${o.bank_paybill}) acc ${o.bank_account}` : 'M-Pesa'} />
        <KeyValue label="Collected today" value={kes(today)} />
        <KeyValue label="Tonight’s payout" value={kes(owed)} />
      </Card>
      {refunds > 0 && <Muted>{`${kes(refunds)} of refunds will be taken off the next payout.`}</Muted>}
      <Button title="Change details" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: '/admin/owner-form', params: { id: String(o.id) } })} />

      <SectionTitle>{`Cars (${vehicles.length})`}</SectionTitle>
      <List>
        {vehicles.map((v) => (
          <ListRow
            key={v.id}
            icon="bus-outline"
            title={v.plate}
            subtitle={`${v.route_name ?? 'No route'} · ${v.today_payments} payment${v.today_payments === 1 ? '' : 's'} today`}
            right={kes(v.today_total)}
            rightSub={v.is_active ? undefined : <Badge text="Not in use" tone="danger" />}
            onPress={() => router.push(`/admin/vehicle/${v.id}`)}
          />
        ))}
      </List>

      <SectionTitle>Payouts</SectionTitle>
      {payouts.length === 0 ? (
        <Muted>No payouts yet.</Muted>
      ) : (
        <List>
          {payouts.map((p) => (
            <ListRow
              key={p.id}
              icon="send-outline"
              title={kes(p.amount)}
              subtitle={`${dateTime(p.created_at)} · ${p.trip_count} fares${p.reference ? ` · ${p.reference}` : ''}`}
              right={p.status}
              onPress={() => router.push(`/admin/payout/${p.id}`)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
