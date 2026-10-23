import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Badge, Card, colors, ErrorBox, KeyValue, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { dateTime, kes, time } from '@/lib/format';
import type { OfficeTripDetail } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const STATE = { loading: 'Loading at the stage', on_the_road: 'On the road', finished: 'Finished' } as const;
const BOOKING: Record<OfficeTripDetail['bookings'][number]['status'], { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  paying: { text: 'Paying…', tone: 'warning' },
  confirmed: { text: 'Paid', tone: 'success' },
  boarded: { text: 'On board', tone: 'success' },
  departed: { text: 'Paid', tone: 'success' },
  cancelled: { text: 'Refunded', tone: 'danger' },
  paid_late: { text: 'Paid late', tone: 'warning' },
};
const displayPhone = (p: string) => (p.startsWith('254') ? `0${p.slice(3)}` : p);

/** One car's loading and trip (?id=): stops reached, every booking and how it was paid, parcels on it. */
export default function Trip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useApi<OfficeTripDetail>(`/admin/trips/${id}`);
  if (trip.loading && !trip.data) return <Loading />;
  const t = trip.data;
  if (!t) return <Screen><ErrorBox message={trip.error ?? 'Trip not found'} onRetry={trip.reload} /></Screen>;

  return (
    <Screen refreshing={trip.refreshing} onRefresh={trip.refresh}>
      <Card>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{t.plate}</Text>
        <Muted>{t.route_name}</Muted>
        <View style={{ height: 6 }} />
        <KeyValue label="Where it is" value={STATE[t.state]} />
        <KeyValue label="Started loading" value={`${dateTime(t.started_at)}${t.started_by_name ? ` (${t.started_by_name})` : ''}`} />
        {t.departed_at && <KeyValue label={`Left ${t.origin}`} value={time(t.departed_at)} />}
        {t.finished_at && <KeyValue label="Trip finished" value={time(t.finished_at)} />}
        <KeyValue label="Seats booked" value={`${t.seats_booked} of ${t.seats}`} />
        <KeyValue label="Booking money" value={kes(t.booking_money)} />
      </Card>

      <SectionTitle>Stops</SectionTitle>
      <Card>
        {t.stops.map((s) => (
          <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <Ionicons name={s.reached_at ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={s.reached_at ? colors.primary : colors.muted} />
            <Text style={{ flex: 1, color: colors.text, fontWeight: '600' }}>{s.name}</Text>
            <Text style={{ color: colors.muted }}>{s.reached_at ? time(s.reached_at) : '—'}</Text>
          </View>
        ))}
      </Card>

      <SectionTitle>Seat bookings</SectionTitle>
      {t.bookings.length === 0 && <Muted>No bookings on this car.</Muted>}
      {t.bookings.map((b) => (
        <Card key={b.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', letterSpacing: 2, color: colors.text }}>{b.code}</Text>
            <Badge text={BOOKING[b.status].text} tone={BOOKING[b.status].tone} />
          </View>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {b.passenger_name} · {displayPhone(b.passenger_phone)}
          </Text>
          <Muted>
            {b.seats} seat{b.seats === 1 ? '' : 's'} to {b.stop_name} · {kes(b.amount)} · {b.paid_with === 'wallet' ? 'wallet' : 'M-Pesa'}
            {b.boarded_at ? ` · boarded ${time(b.boarded_at)}` : ''}
          </Muted>
        </Card>
      ))}
      <Muted>To refund a booking, find its payment under Payments: the passenger gets the money in their wallet and the seat is freed.</Muted>

      {t.parcels.length > 0 && (
        <>
          <SectionTitle>Parcels on this car</SectionTitle>
          <List>
            {t.parcels.map((p) => (
              <ListRow key={p.id} icon="cube-outline" title={p.tracking_code} subtitle={`To ${p.stop_name} · ${p.receiver_name}`} onPress={() => router.push({ pathname: '/admin/parcel/[id]', params: { id: String(p.id) } })} />
            ))}
          </List>
        </>
      )}
    </Screen>
  );
}
