import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { Trip } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { openTicket } from '@/lib/ticket';

/** All the passenger's payments; tap one to show its ticket again. */
export default function MyPayments() {
  const trips = usePaged<Trip>('/passenger/trips');
  if (trips.loading) return <Loading />;

  return (
    <Screen refreshing={trips.refreshing} onRefresh={trips.refresh}>
      {trips.error && <ErrorBox message={trips.error} onRetry={trips.reload} />}
      {trips.items.length === 0 && !trips.error && <Empty text="No payments yet." />}
      {trips.items.length > 0 && (
        <List>
          {trips.items.map((t) => (
            <ListRow
              key={t.id}
              icon="bus-outline"
              title={`${t.plate} · to ${t.stop_name ?? t.route_name}`}
              subtitle={`${dateTime(t.created_at)} · Ticket ${t.ticket_code}`}
              right={kes(t.fare)}
              rightSub={t.status === 'refunded' ? <Badge text="Refunded" tone="danger" /> : undefined}
              onPress={() => openTicket(t)}
            />
          ))}
        </List>
      )}
      {trips.hasMore && <Button title="Load more" variant="secondary" onPress={trips.loadMore} loading={trips.loadingMore} />}
    </Screen>
  );
}
