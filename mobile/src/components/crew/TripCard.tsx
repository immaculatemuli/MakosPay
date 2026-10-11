import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { kes, time } from '@/lib/format';
import type { Run } from '@/lib/types';
import { Button, Card, colors, Muted } from '../ui';

/**
 * The crew's current trip: "Start trip" when none is running, otherwise how long it's been going, the
 * payments and total so far, and "End trip". Fares paid while it runs are counted in it.
 */
export function TripCard({ current, hasRoute, onChange }: { current: Run | null | undefined; hasRoute: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  const act = async (request: () => Promise<Run>, done?: (run: Run) => void) => {
    setBusy(true);
    try {
      const run = await request();
      done?.(run);
      onChange();
    } catch (err) {
      Alert.alert('Something went wrong', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const start = () => act(() => api<Run>('/crew/runs', { method: 'POST' }));

  const end = (run: Run) =>
    Alert.alert('End this trip?', `${run.payments} payment${run.payments === 1 ? '' : 's'}, ${kes(run.total)} collected.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'End trip',
        onPress: () =>
          act(
            () => api<Run>(`/crew/runs/${run.id}/end`, { method: 'POST' }),
            (r) => Alert.alert('Trip ended', `${r.payments} payment${r.payments === 1 ? '' : 's'} · ${kes(r.total)} collected.`),
          ),
      },
    ]);

  if (current === undefined) return null;

  if (!current) {
    return (
      <Card>
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>No trip in progress</Text>
        <Muted>{hasRoute ? 'Start a trip when the vehicle leaves, so the trip’s collection is counted.' : 'Set the route first, then start the trip.'}</Muted>
        <View style={{ height: 10 }} />
        <Button title="Start trip" icon="play-circle-outline" onPress={start} loading={busy} disabled={!hasRoute} />
      </Card>
    );
  }

  return (
    <Card style={{ borderColor: colors.primary, borderWidth: 1 }}>
      <Text style={{ fontWeight: '700', fontSize: 16, color: colors.primaryDark }}>Trip in progress</Text>
      <Muted>
        Started {time(current.started_at)} by {current.started_by_name}
        {current.route_name ? ` · ${current.route_name}` : ''}
      </Muted>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 }}>
        <View>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Collected this trip</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{kes(current.total)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Payments</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{current.payments}</Text>
        </View>
      </View>
      <Button title="End trip" variant="secondary" icon="stop-circle-outline" onPress={() => end(current)} loading={busy} />
    </Card>
  );
}
