import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Badge, Button, Card, colors, ErrorBox, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { QueueBooking } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const REFRESH_EVERY_MS = 10_000;

/**
 * Passengers who booked and paid, put on this car by the stage marshal: whom to pick where. Made for a driver (most
 * matatus have no conductor): big text, one big button, a call button, and the phone buzzes when a pickup is added.
 */
export function SeatPickups() {
  const { t } = useT();
  const seats = useApi<QueueBooking[]>('/crew/seats');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<Set<number> | null>(null);

  const { reload } = seats;
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void reload(), REFRESH_EVERY_MS);
      return () => clearInterval(timer);
    }, [reload]),
  );

  // A new pickup (not seen on this screen before): buzz and say so. The first load only remembers what is there.
  const list = seats.data;
  useEffect(() => {
    if (!list) return;
    const fresh = list.filter((b) => b.status === 'assigned' && known.current && !known.current.has(b.id));
    known.current = new Set(list.map((b) => b.id));
    if (fresh.length === 0) return;
    Vibration.vibrate([0, 600, 300, 600]);
    const b = fresh[0];
    Alert.alert(
      b.at_stage ? t('{n} booked at the stage', { n: b.seats }) : t('Pick {n} at {place}', { n: b.seats, place: b.pickup_name ?? '' }),
      `${b.passenger_name} · ${b.code} · ${t('to {place}', { place: b.stop_name })}`,
    );
  }, [list, t]);

  if (!list || list.length === 0) return seats.error ? <ErrorBox message={seats.error} onRetry={seats.reload} /> : null;

  const board = async (b: QueueBooking) => {
    setBusy(b.id);
    setError(null);
    try {
      seats.setData(await api<QueueBooking[]>(`/crew/seats/${b.id}/board`, { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const toPick = list.filter((b) => b.status === 'assigned');
  const onBoard = list.filter((b) => b.status === 'boarded');
  return (
    <View>
      {toPick.length > 0 && <SectionTitle>{t('Paid passengers to pick')}</SectionTitle>}
      {error && <ErrorBox message={error} />}
      {toPick.map((b) => (
        <Card key={b.id} style={styles.card}>
          <Text style={styles.where}>
            {b.at_stage ? t('At the stage: {n} seats', { n: b.seats }) : t('Pick {n} at {place}', { n: b.seats, place: b.pickup_name ?? '' })}
          </Text>
          <Text style={styles.who}>{b.passenger_name}</Text>
          <Text style={styles.detail}>
            {t('Code {code}', { code: b.code })} · {t('to {place}', { place: b.stop_name })}
          </Text>
          {b.passenger_here && <Badge text={t('Waiting there now')} tone="success" />}
          <View style={styles.buttons}>
            <Pressable
              onPress={() => void Linking.openURL(`tel:${displayPhone(b.passenger_phone)}`)}
              style={({ pressed }) => [styles.call, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={t('Call {name}', { name: b.passenger_name })}
            >
              <Ionicons name="call" size={28} color={colors.primary} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button title={t('Picked up')} icon="checkmark-circle" loading={busy === b.id} onPress={() => void board(b)} />
            </View>
          </View>
        </Card>
      ))}
      {onBoard.length > 0 && (
        <Text style={styles.onBoard}>
          {t('On board: {names}', { names: onBoard.map((b) => `${b.passenger_name} (${b.seats})`).join(', ') })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: colors.primary, borderWidth: 2 },
  where: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
  who: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 4 },
  detail: { fontSize: 16, color: colors.muted, marginTop: 2, marginBottom: 6 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  call: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  onBoard: { fontSize: 14, color: colors.muted, marginVertical: 8 },
});
