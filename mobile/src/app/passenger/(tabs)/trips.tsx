import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { dateTime, dayTime, kes } from '@/lib/format';
import { SEAT_WORD } from '@/lib/seatText';
import type { SeatBooking, Trip } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { usePaged } from '@/lib/usePaged';
import { loadSavedTickets, saveTickets } from '@/lib/savedTickets';
import { openTicket } from '@/lib/ticket';
import { useT } from '@/lib/i18n';

/** The passenger's seat bookings this week, then all their fare payments (tap one to show its ticket again). Without internet: the tickets saved on the phone. */
export default function MyPayments() {
  const { t } = useT();
  const trips = usePaged<Trip>('/passenger/trips');
  const seats = useApi<SeatBooking[]>('/passenger/seats');
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
  const refresh = () => {
    trips.refresh();
    seats.refresh();
  };

  return (
    <Screen refreshing={trips.refreshing || seats.refreshing} onRefresh={refresh}>
      {!!seats.data?.length && (
        <>
          <SectionTitle>{t('Seat bookings')}</SectionTitle>
          <List>
            {seats.data.map((b) => (
              <ListRow
                key={b.id}
                icon={['paying', 'queued', 'assigned'].includes(b.status) ? 'ticket-outline' : 'time-outline'}
                title={`${b.code}${b.car ? ` · ${b.car.plate}` : ''}`}
                subtitle={`${dateTime(b.booked_at)} · ${b.pickup.name} → ${b.stop_name}`}
                right={kes(b.amount)}
                rightSub={<Badge text={b.later && b.ready_at && ['paying', 'queued'].includes(b.status) ? dayTime(b.ready_at) : t(SEAT_WORD[b.status])} tone={b.status === 'cancelled' ? 'danger' : 'neutral'} />}
                onPress={() => router.push({ pathname: '/passenger/booking', params: { id: String(b.id) } })}
              />
            ))}
          </List>
          <SectionTitle>{t('Fares paid')}</SectionTitle>
        </>
      )}
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
