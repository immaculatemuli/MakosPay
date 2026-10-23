import { useEffect, useState } from 'react';
import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { Trip } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { loadSavedTickets, saveTickets } from '@/lib/savedTickets';
import { openTicket } from '@/lib/ticket';
import { useT } from '@/lib/i18n';

/** All the passenger's payments; tap one to show its ticket again. Without internet: the tickets saved on the phone. */
export default function MyPayments() {
  const { t } = useT();
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
      {offline && !!saved?.length && <Notice>{t('Can’t reach FarePay. These are the tickets saved on this phone.')}</Notice>}
      {shown.length === 0 && !trips.error && <Empty text={t('No payments yet.')} />}
      {shown.length > 0 && (
        <List>
          {shown.map((trip) => (
            <ListRow
              key={trip.id}
              icon="bus-outline"
              title={`${trip.plate} · ${t('to {place}', { place: trip.stop_name ?? trip.route_name })}`}
              subtitle={`${dateTime(trip.created_at)} · ${t('Ticket {code}', { code: trip.ticket_code })}`}
              right={kes(trip.fare)}
              rightSub={trip.status === 'refunded' ? <Badge text={t('Refunded')} tone="danger" /> : undefined}
              onPress={() => openTicket(trip)}
            />
          ))}
        </List>
      )}
      {trips.hasMore && <Button title={t('Load more')} variant="secondary" onPress={trips.loadMore} loading={trips.loadingMore} />}
    </Screen>
  );
}
