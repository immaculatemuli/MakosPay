import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Vibration } from 'react-native';
import { QrScanner, SEAT_BOOKING } from '@/components/QrScanner';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

type Boarded = { code: string; passenger_name: string; seats: number; stop_name: string; plate: string; already_boarded: boolean };
type Result = { ok: true; boarded: Boarded } | { ok: false; message: string };

const NEXT_SCAN_MS = 2500;

/**
 * Boarding at the stage or on the road: scan the QR on each passenger's booking screen, one after another. Each scan
 * shows who it is (name, seats, where they get off) in green, or why they can't board in red, then scans the next.
 * `endpoint` is the marshal's (any car) or the crew's (their car only).
 */
export function BoardScanner({ endpoint }: { endpoint: string }) {
  const { t } = useT();
  const [result, setResult] = useState<Result | null>(null);
  const [round, setRound] = useState(0); // a new scanner for each passenger
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const next = () => {
    clearTimeout(timer.current);
    setResult(null);
    setRound((r) => r + 1);
  };

  const board = async (data: string) => {
    setBusy(true);
    try {
      const boarded = await api<Boarded>(endpoint, { method: 'POST', body: { code: data } });
      setResult({ ok: true, boarded });
      Vibration.vibrate(120);
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
      Vibration.vibrate([0, 300, 150, 300]);
    } finally {
      setBusy(false);
      timer.current = setTimeout(next, NEXT_SCAN_MS);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {!result && !busy && (
        <QrScanner key={round} accept={SEAT_BOOKING} aimHint={t('Scan the QR code on the passenger’s booking')} onCode={(data) => void board(data)} />
      )}
      {(result || busy) && (
        <Pressable style={[styles.result, result && !result.ok ? styles.bad : styles.good]} onPress={next}>
          {busy && <Text style={styles.big}>{t('Checking…')}</Text>}
          {result?.ok && (
            <>
              <Ionicons name="checkmark-circle" size={72} color="#fff" />
              <Text style={styles.big}>{result.boarded.passenger_name}</Text>
              <Text style={styles.line}>
                {t(result.boarded.seats === 1 ? '{n} seat' : '{n} seats', { n: result.boarded.seats })} · {t('to {place}', { place: result.boarded.stop_name })}
              </Text>
              <Text style={styles.line}>{result.boarded.already_boarded ? t('Already on board') : t('On board {plate}', { plate: result.boarded.plate })}</Text>
            </>
          )}
          {result && !result.ok && (
            <>
              <Ionicons name="close-circle" size={72} color="#fff" />
              <Text style={styles.big}>{t('Can’t board')}</Text>
              <Text style={styles.line}>{result.message}</Text>
            </>
          )}
          {result && <Text style={styles.tap}>{t('Tap to scan the next passenger')}</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  result: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  good: { backgroundColor: '#15803D' },
  bad: { backgroundColor: '#B91C1C' },
  big: { color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center' },
  line: { color: '#fff', fontSize: 19, fontWeight: '600', textAlign: 'center' },
  tap: { color: '#ffffffcc', fontSize: 15, marginTop: 24 },
});
