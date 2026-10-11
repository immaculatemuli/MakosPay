import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { kes, prettyDate } from '@/lib/format';
import { colors } from './ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (ymd: string) => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const CHART_HEIGHT = 140;

/** One bar per day; tap a bar to see that day's amount. Starts on the last day (today). */
export function DayBars({ days }: { days: { date: string; payments: number; total: number }[] }) {
  const [selected, setSelected] = useState(days.length - 1);
  const max = Math.max(...days.map((d) => d.total), 1);
  const day = days[Math.min(selected, days.length - 1)];
  // With 30 bars there is no room for a label under each one: show the first and last dates instead.
  const narrow = days.length > 10;

  return (
    <View>
      <Text style={styles.selectedValue}>{kes(day.total)}</Text>
      <Text style={styles.selectedSub}>
        {weekday(day.date)} {prettyDate(day.date)} · {day.payments} payment{day.payments === 1 ? '' : 's'}
      </Text>
      <View style={styles.bars}>
        {days.map((d, i) => (
          <Pressable
            key={d.date}
            onPress={() => setSelected(i)}
            style={styles.barSlot}
            accessibilityLabel={`${prettyDate(d.date)}: ${kes(d.total)}`}
          >
            <View
              style={[
                styles.bar,
                { height: Math.max((d.total / max) * CHART_HEIGHT, d.total > 0 ? 3 : 1) },
                { backgroundColor: i === selected ? colors.primaryDark : d.total > 0 ? colors.primary : colors.border },
              ]}
            />
          </Pressable>
        ))}
      </View>
      {narrow ? (
        <View style={[styles.labels, { justifyContent: 'space-between' }]}>
          <Text style={styles.edgeLabel}>{prettyDate(days[0].date)}</Text>
          <Text style={styles.edgeLabel}>{prettyDate(days[days.length - 1].date)}</Text>
        </View>
      ) : (
        <View style={styles.labels}>
          {days.map((d) => (
            <Text key={d.date} style={styles.label} numberOfLines={1}>
              {weekday(d.date)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

/** A row with a name, an amount and a bar showing its share of the largest row. */
export function ShareRow({ title, subtitle, value, share }: { title: string; subtitle: string; value: string; share: number }) {
  return (
    <View style={styles.shareRow}>
      <View style={styles.shareTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shareTitle}>{title}</Text>
          <Text style={styles.shareSub}>{subtitle}</Text>
        </View>
        <Text style={styles.shareValue}>{value}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(Math.max(0, Math.min(share, 1)) * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  selectedValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  selectedSub: { fontSize: 13, color: colors.muted, marginBottom: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  labels: { flexDirection: 'row', gap: 2, marginTop: 6 },
  label: { flex: 1, fontSize: 11, color: colors.muted, textAlign: 'center' },
  edgeLabel: { fontSize: 11, color: colors.muted },
  shareRow: { paddingVertical: 10 },
  shareTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  shareTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  shareSub: { fontSize: 13, color: colors.muted },
  shareValue: { fontSize: 15, fontWeight: '700', color: colors.text, marginLeft: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
});
