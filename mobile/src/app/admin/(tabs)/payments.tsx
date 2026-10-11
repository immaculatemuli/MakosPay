import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Chips, colors, Empty, ErrorBox, List, ListRow, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { displayPhone, kes, nairobiDate, prettyDate, time } from '@/lib/format';
import type { AdminDay } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const DAYS = [
  { value: 0, label: 'Today' },
  { value: -1, label: 'Yesterday' },
  { value: -2, label: '2 days ago' },
  { value: -3, label: '3 days ago' },
];

/** Every payment on every vehicle, by day, with each vehicle's takings. Tap a vehicle to see only its payments. */
export default function Payments() {
  const [day, setDay] = useState(0);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const date = nairobiDate(day);
  const data = useApi<AdminDay>(`/admin/payments?date=${date}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`);
  if (data.loading && !data.data) return <Loading />;
  const d = data.data;

  return (
    <Screen refreshing={data.refreshing} onRefresh={data.refresh}>
      <Chips
        options={DAYS}
        value={day}
        onChange={(v) => {
          setDay(v);
          setVehicleId(null);
        }}
      />
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}

      {d && (
        <Card>
          <Text style={styles.cardLabel}>{day === 0 ? 'Collected today' : prettyDate(date)}</Text>
          <View style={styles.totals}>
            <Text style={styles.total}>{kes(d.summary.total)}</Text>
            <Text style={styles.count}>{d.summary.payments} payment{d.summary.payments === 1 ? '' : 's'}</Text>
          </View>
        </Card>
      )}

      {!!d?.summary.by_vehicle.length && (
        <>
          <SectionTitle>By vehicle</SectionTitle>
          <List>
            {d.summary.by_vehicle.map((v) => (
              <ListRow
                key={v.id}
                icon={vehicleId === v.id ? 'checkmark-circle' : 'bus-outline'}
                title={v.plate}
                subtitle={`Owner ${v.owner_name} · ${v.payments} payment${v.payments === 1 ? '' : 's'}`}
                right={kes(v.total)}
                onPress={() => setVehicleId(vehicleId === v.id ? null : v.id)}
              />
            ))}
          </List>
          <Muted>{vehicleId ? 'Showing one vehicle. Tap it again to see all.' : 'Tap a vehicle to see only its payments. Tap a payment to refund it.'}</Muted>
        </>
      )}

      <SectionTitle>Payments</SectionTitle>
      {d?.payments.length === 0 && <Empty text="No payments on this day." />}
      {!!d?.payments.length && (
        <List>
          {d.payments.map((p) => (
            <ListRow
              key={p.id}
              icon="person-circle-outline"
              title={`${p.passenger_name} · ${p.plate}`}
              subtitle={`${time(p.created_at)} · to ${p.stop_name ?? p.route_name} · ${displayPhone(p.passenger_phone ?? null)}`}
              right={kes(p.fare)}
              rightSub={
                p.status === 'refunded' ? (
                  <Badge text="Refunded" tone="danger" />
                ) : p.payout_id ? (
                  <Badge text="Paid to owner" tone="success" />
                ) : (
                  <Badge text="Owed to owner" tone="warning" />
                )
              }
              onPress={
                p.status === 'paid'
                  ? () =>
                      router.push({
                        pathname: '/admin/refund',
                        params: {
                          id: p.id,
                          passenger: p.passenger_name ?? '',
                          plate: p.plate,
                          stop: p.stop_name ?? p.route_name,
                          fare: String(p.fare),
                          ticket: p.ticket_code,
                          paidOut: p.payout_id ? '1' : '0',
                        },
                      })
                  : () => Alert.alert('Refunded', `${kes(p.fare)} was refunded to ${p.passenger_name}.\nReason: ${p.refund_reason ?? '—'}`)
              }
            />
          ))}
        </List>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardLabel: { color: colors.muted, fontSize: 14 },
  totals: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 },
  total: { fontSize: 30, fontWeight: '800', color: colors.text },
  count: { fontSize: 15, color: colors.muted, fontWeight: '600' },
});
