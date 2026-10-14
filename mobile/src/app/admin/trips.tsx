import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { kes, nairobiDate, time } from '@/lib/format';
import type { OfficeTrip } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const STATE: Record<OfficeTrip['state'], string> = { loading: 'Loading', on_the_road: 'On the road', finished: 'Finished' };

/** Cars taking seat bookings at the stage, trips on the road, and every car that loaded today or yesterday. */
export default function Trips() {
  const [days, setDays] = useState(0);
  const date = nairobiDate(-days);
  const trips = useApi<{ now: { loading: number; on_the_road: number }; day: { cars: number; seats_booked: number; paid_bookings: number; booking_money: number }; trips: OfficeTrip[] }>(
    `/admin/trips?date=${date}`,
  );
  if (trips.loading && !trips.data) return <Loading />;
  const d = trips.data;

  return (
    <Screen refreshing={trips.refreshing} onRefresh={trips.refresh}>
      {trips.error && <ErrorBox message={trips.error} onRetry={trips.reload} />}
      <Chips
        options={[
          { value: 0, label: 'Today' },
          { value: 1, label: 'Yesterday' },
        ]}
        value={days}
        onChange={setDays}
      />
      {d && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            [String(d.now.loading), 'Loading now'],
            [String(d.now.on_the_road), 'On the road'],
            [String(d.day.seats_booked), 'Seats booked'],
            [kes(d.day.booking_money), 'Booking money'],
          ].map(([value, label]) => (
            <Card key={label} style={{ flex: 1, padding: 10 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.primaryDark }}>{value}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
            </Card>
          ))}
        </View>
      )}
      <SectionTitle>Cars</SectionTitle>
      {d?.trips.length === 0 && <Empty text="No car took bookings on this day. Conductors start loading from their Bookings tab." />}
      {!!d?.trips.length && (
        <List>
          {d.trips.map((t) => (
            <ListRow
              key={t.id}
              icon={t.state === 'loading' ? 'people-outline' : t.state === 'on_the_road' ? 'bus-outline' : 'flag-outline'}
              title={`${t.plate} · ${t.route_name}`}
              subtitle={`${STATE[t.state]} · ${t.seats_booked}/${t.seats} seats · ${t.departed_at ? `left ${time(t.departed_at)}` : `since ${time(t.started_at)}`}`}
              right={kes(t.booking_money)}
              onPress={() => router.push({ pathname: '/admin/trip/[id]', params: { id: String(t.id) } })}
            />
          ))}
        </List>
      )}
      <Muted>Booking money is fares: it goes to the owners with the evening payout.</Muted>
    </Screen>
  );
}
