import { useEffect, useState } from 'react';
import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { Trip } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { loadSavedTickets, saveTickets } from '@/lib/savedTickets';
import { openTicket } from '@/lib/ticket';

/** All the passenger's payments; tap one to show its ticket again. Without internet: the tickets saved on the phone. */
export default function MyPayments() {
  const trips = usePaged<Trip>('/passenger/trips');
  const [saved, setSaved] = useState<Trip[] | null>(null);
  const offline = Boolean(trips.error) && trips.items.length === 0;
  useEffect(() => {
    if (trips.items.length) void saveTickets(trips.items);
  }, [trips.items]);
  useEffect(() => {
    if (offline) void loadSavedTickets().then(setSaved);
  }, [offline]);
  if (trips.loading) return <Loading />;
  const shown = offline ? (saved ?? []) : trips.items;

  return (
    <Screen refreshing={trips.refreshing} onRefresh={trips.refresh}>
      {trips.error && <ErrorBox message={trips.error} onRetry={trips.reload} />}
      {offline && !!saved?.length && <Notice>{"Can't reach FarePay. These are the tickets saved on this phone."}</Notice>}
      {shown.length === 0 && !trips.error && <Empty text="No payments yet." />}
      {shown.length > 0 && (
        <List>
          {shown.map((t) => (
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
