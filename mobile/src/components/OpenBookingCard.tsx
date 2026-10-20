import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { SEAT_TITLE, seatLine } from '@/lib/seatText';
import type { SeatBooking } from '@/lib/types';

/**
 * The passenger's booking that is happening now (paying, in the queue, or a car coming), at the top of their home
 * screen in the same words as the booking itself: "Board KDA 123A now". Tapping opens it (with the QR to show).
 */
export function OpenBookingCard({ booking: b }: { booking: SeatBooking }) {
  const { t } = useT();
  const urgent = b.status === 'assigned';
  return (
    <Pressable
      style={({ pressed }) => [styles.card, urgent && styles.urgent, pressed && { opacity: 0.8 }]}
      onPress={() => router.push({ pathname: '/passenger/booking', params: { id: String(b.id) } })}
      accessibilityRole="button"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name={urgent ? 'bus' : 'time-outline'} size={28} color={urgent ? '#fff' : colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, urgent && { color: '#fff' }]}>
            {b.status === 'assigned' && b.car ? `${t(SEAT_TITLE[b.status])}: ${b.car.plate}` : t(SEAT_TITLE[b.status])} · {b.code}
          </Text>
          <Text style={[styles.line, urgent && { color: '#fff' }]}>{seatLine(b)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={urgent ? '#fff' : colors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 2, borderColor: colors.primary },
  urgent: { backgroundColor: colors.primary },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  line: { fontSize: 14, color: colors.text, marginTop: 2 },
});
