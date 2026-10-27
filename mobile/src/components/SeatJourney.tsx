import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { kes, time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { SeatBooking } from '@/lib/types';
import { Card, colors } from './ui';

type Step = { title: string; detail?: string | null; state: 'done' | 'now' | 'next' };

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** "in 1 h 5 min", "in 9 min", "in under a minute". */
function untilText(ms: number, t: ReturnType<typeof useT>['t']) {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return t('in under a minute');
  if (minutes < 60) return t('in {n} min', { n: minutes });
  return t('in {h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/** Ticks every 30 s while counting down to a time; calls onDue once it has passed. */
export function useCountdown(iso: string | null, onDue: () => void) {
  const [now, setNow] = useState(() => Date.now());
  const left = iso ? Date.parse(iso) - now : null;
  useEffect(() => {
    if (left === null || left <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), Math.min(30_000, left + 1000));
    return () => clearInterval(timer);
  }, [left]);
  useEffect(() => {
    if (left !== null && left <= 0) onDue();
  }, [left !== null && left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

/** A paid seat booking as a journey: paid → in the queue → the car → on board → arrived, with what is happening now. */
export function SeatJourney({ b, onDue }: { b: SeatBooking; onDue: () => void }) {
  const { t } = useT();
  const left = useCountdown(b.later ? b.ready_at : null, onDue);
  const arrived = b.status === 'boarded' && !!b.car?.reached_my_stop;
  const reachedAt = b.car?.stops?.find((s) => s.mine)?.reached_at ?? null;
  const plate = b.car?.plate ?? '';

  const queueDetail = b.later && b.ready_at && left !== null
    ? t('You join at {time} · {until}', { time: time(b.ready_at), until: untilText(left, t) })
    : b.status === 'queued'
      ? b.pickup.at_stage
        ? b.place_in_queue === 0
          ? t('You’re next')
          : t('{nth} in line', { nth: ordinal((b.place_in_queue ?? 0) + 1) })
        : t('A car will be sent for you')
      : null;

  const carDetail =
    b.status === 'assigned' && b.car
      ? b.car.expected_at_pickup
        ? t('Usually reaches {place} about {time}', { place: b.pickup.name, time: time(b.car.expected_at_pickup) })
        : b.assigned_at && t('Given to you at {time}', { time: time(b.assigned_at) })
      : null;

  const steps: Step[] = [
    { title: b.free_ride ? t('Free ride') : t('Paid {amount}', { amount: kes(b.amount) }), detail: time(b.booked_at), state: 'done' },
    {
      title: b.pickup.at_stage ? t('In the queue at {place}', { place: b.pickup.name }) : t('Waiting at {place}', { place: b.pickup.name }),
      detail: queueDetail,
      state: b.status === 'queued' ? 'now' : 'done',
    },
    {
      title: b.status === 'queued' ? t('Your car') : b.pickup.at_stage ? t('Board {plate}', { plate }) : t('{plate} is coming for you', { plate }),
      detail: carDetail,
      state: b.status === 'queued' ? 'next' : b.status === 'assigned' ? 'now' : 'done',
    },
    {
      title: b.status === 'boarded' ? t('On board {plate}', { plate }) : t('On board'),
      detail:
        b.status === 'boarded' && !arrived && b.car?.expected_at_my_stop
          ? t('Usually at {stop} about {time}', { stop: b.stop_name, time: time(b.car.expected_at_my_stop) })
          : b.boarded_at && time(b.boarded_at),
      state: b.status === 'boarded' ? (arrived ? 'done' : 'now') : 'next',
    },
    {
      title: t('Arrived at {stop}', { stop: b.stop_name }),
      detail: arrived && reachedAt ? time(reachedAt) : null,
      state: arrived ? 'done' : 'next',
    },
  ];

  return (
    <Card>
      {steps.map((step, i) => (
        <View key={i} style={styles.step}>
          <View style={styles.rail}>
            <View style={[styles.dot, step.state === 'done' && styles.dotDone, step.state === 'now' && styles.dotNow]}>
              {step.state === 'done' && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
            {i < steps.length - 1 && <View style={[styles.stem, step.state === 'done' && { backgroundColor: colors.primary }]} />}
          </View>
          <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
            <Text style={[styles.title, step.state === 'next' && { color: colors.muted, fontWeight: '500' }, step.state === 'now' && { color: colors.primaryDark }]}>
              {step.title}
            </Text>
            {!!step.detail && <Text style={styles.detail}>{step.detail}</Text>}
          </View>
        </View>
      ))}
    </Card>
  );
}

/** On board: the stops still to come up to the drop-off, ticked as the crew reach them. */
export function RideStops({ b }: { b: SeatBooking }) {
  const { t } = useT();
  const stops = b.car?.stops;
  if (b.status !== 'boarded' || !stops?.length || b.car?.reached_my_stop) return null;
  return (
    <Card>
      <Text style={[styles.title, { marginBottom: 10 }]}>{t('Your ride')}</Text>
      {stops.map((s) => (
        <View key={s.name} style={styles.rideStop}>
          <Ionicons
            name={s.reached_at ? 'checkmark-circle' : s.mine ? 'flag' : 'ellipse-outline'}
            size={18}
            color={s.reached_at || s.mine ? colors.primary : colors.muted}
          />
          <Text style={[styles.rideName, s.mine && { fontWeight: '700' }]}>{s.name}</Text>
          <Text style={styles.detail}>{s.reached_at ? t('passed {time}', { time: time(s.reached_at) }) : s.mine ? t('you get off here') : ''}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row' },
  rail: { width: 26, alignItems: 'center', marginRight: 12 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotNow: { borderColor: colors.primary, borderWidth: 6 },
  stem: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  detail: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rideStop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rideName: { flex: 1, fontSize: 15, color: colors.text },
});
