import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { saveChosenStop, type ChosenStop } from '@/lib/chosenRoute';
import { kes } from '@/lib/format';
import type { StopChoice } from '@/lib/types';
import { colors } from './ui';

/**
 * "Where are you going?": the chosen drop-off (tap to change) and one-tap chips for the passenger's saved
 * and most-used drop-offs. `onChosen` is called after a chip is tapped, so the screen can refresh.
 */
export function WhereGoing({
  chosen,
  saved,
  frequent,
  onChosen,
}: {
  chosen: ChosenStop | null | undefined;
  saved: StopChoice[];
  frequent: StopChoice[];
  onChosen: () => void;
}) {
  // Saved first, then frequent ones not already saved.
  const quick = [...saved, ...frequent.filter((f) => !saved.some((s) => s.stop_id === f.stop_id))];

  const pick = async (s: StopChoice) => {
    await saveChosenStop({ route_id: s.route_id, route_name: s.route_name, stop_id: s.stop_id, stop_name: s.stop_name });
    onChosen();
  };

  return (
    <View>
      <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]} onPress={() => router.push('/passenger/choose-route')}>
        <Ionicons name="map-outline" size={24} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{chosen ? `Get off at ${chosen.stop_name}` : 'Choose your route and drop-off'}</Text>
          <Text style={styles.hint}>{chosen ? `${chosen.route_name} · tap to change` : 'Your fare depends on where you get off'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
      </Pressable>
      {quick.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
          {quick.map((s) => {
            const selected = chosen?.stop_id === s.stop_id;
            const isSaved = saved.some((x) => x.stop_id === s.stop_id);
            return (
              <Pressable key={s.stop_id} onPress={() => pick(s)} style={[styles.chip, selected && styles.chipSelected]}>
                <Ionicons name={isSaved ? 'star' : 'time-outline'} size={14} color={selected ? '#fff' : colors.primary} />
                <Text style={[styles.chipText, selected && { color: '#fff' }]}>
                  {s.stop_name} · {kes(s.app_fare)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  hint: { fontSize: 13, color: colors.muted, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 14 },
});
