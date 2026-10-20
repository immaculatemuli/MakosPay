import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { type LayoutRectangle, StyleSheet, Text, View } from 'react-native';
import { Button, colors, Loading, Muted, Screen } from '@/components/ui';
import { useT } from '@/lib/i18n';

// A scan only counts when it is clearly a FarePay sticker, the WHOLE code is inside the square (all four
// corners), it is big enough to be the sticker the passenger is pointing at (not one across the stage), and the
// same code is read several times in a row. Anything else - part of a code, a code at the edge of the camera,
// a neighbouring matatu's sticker, or a read the camera can't place on screen - is ignored.
// Stickers are either the app's own code or a link to the pay page (which any phone camera can open).
const FAREPAY_CODE = /^(farepay:\/\/pay|https:\/\/[^/?#\s]+\/pay)\?v=[A-Za-z0-9_-]{6,}$/;
const READS_NEEDED = 3;
const READ_WINDOW_MS = 1500;
const MIN_SIZE = 0.4; // the code must fill at least this share of the square

type Hint = 'aim' | 'fit' | 'closer' | 'hold' | 'other';
const HINTS: Record<Hint, string> = {
  aim: 'Point the camera at the FarePay QR code inside the vehicle',
  fit: 'Fit the whole QR code inside the square',
  closer: 'Move closer to the QR code',
  hold: 'Hold still…',
  other: 'That is not a FarePay code',
};

type Point = { x: number; y: number };

function cornersOf(result: BarcodeScanningResult): Point[] {
  if (result.cornerPoints?.length) return result.cornerPoints;
  const b = result.bounds;
  if (!b?.size?.width) return [];
  const { x, y } = b.origin;
  return [
    { x, y },
    { x: x + b.size.width, y },
    { x, y: y + b.size.height },
    { x: x + b.size.width, y: y + b.size.height },
  ];
}

/** Why this read can't count, or null when the whole code is inside the square and big enough. */
function placementProblem(corners: Point[], frame: LayoutRectangle | null): Hint | null {
  // Not yet laid out, or the camera didn't say where the code is: it can't be shown to be inside, so it doesn't count.
  if (!frame || corners.length < 4) return 'fit';
  const inside = corners.every((p) => p.x >= frame.x && p.x <= frame.x + frame.width && p.y >= frame.y && p.y <= frame.y + frame.height);
  if (!inside) return 'fit';
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return size < frame.width * MIN_SIZE ? 'closer' : null;
}

/**
 * The camera with the FarePay square: calls onCode once with a sticker's text when the whole code is inside the square,
 * big enough and read several times. Scanning works again when the screen comes back into view.
 */
export function QrScanner({ onCode }: { onCode: (data: string) => void }) {
  const { t } = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [hint, setHint] = useState<Hint>('aim');
  const handled = useRef(false);
  const frame = useRef<LayoutRectangle | null>(null);
  const streak = useRef({ data: '', count: 0, since: 0 });
  const quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef<Hint>('aim');

  const show = (next: Hint) => {
    if (shown.current !== next) {
      shown.current = next;
      setHint(next);
    }
    // Back to the normal instruction when the camera stops seeing a code.
    clearTimeout(quiet.current);
    quiet.current = setTimeout(() => {
      streak.current.count = 0;
      shown.current = 'aim';
      setHint('aim');
    }, 800);
  };

  // Allow scanning again when the passenger comes back to this screen.
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
      streak.current = { data: '', count: 0, since: 0 };
      return () => clearTimeout(quiet.current);
    }, []),
  );

  const onScanned = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    const data = (result.data ?? '').trim();
    if (!FAREPAY_CODE.test(data)) {
      streak.current.count = 0;
      return show('other');
    }
    const problem = placementProblem(cornersOf(result), frame.current);
    if (problem) {
      streak.current.count = 0;
      return show(problem);
    }
    const now = Date.now();
    const s = streak.current;
    if (s.data === data && s.count > 0 && now - s.since <= READ_WINDOW_MS) s.count += 1;
    else streak.current = { data, count: 1, since: now };
    if (streak.current.count < READS_NEEDED) return show('hold');

    handled.current = true;
    clearTimeout(quiet.current);
    onCode(data);
  };

  if (!permission) return <Loading />;

  if (!permission.granted) {
    return (
      <Screen>
        <Muted>{t('FarePay needs the camera to scan the QR code inside the vehicle.')}</Muted>
        <View style={{ height: 16 }} />
        <Button title={t('Allow camera')} icon="camera-outline" onPress={requestPermission} />
        {!permission.canAskAgain && <Muted>{t('Camera access is blocked. Turn it on for Expo Go / FarePay in your phone settings.')}</Muted>}
      </Screen>
    );
  }

  const frameColor = hint === 'hold' ? colors.primary : hint === 'other' || hint === 'fit' || hint === 'closer' ? colors.danger : colors.primarySoft;
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
      <View style={styles.overlay} pointerEvents="none">
        <View
          style={[styles.frame, { borderColor: frameColor }]}
          onLayout={(e) => {
            frame.current = e.nativeEvent.layout;
          }}
        />
        <Text style={styles.hint}>{t(HINTS[hint])}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The frame sits in the middle of the screen; the hint hangs below it without moving it.
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 260, height: 260, borderWidth: 4, borderRadius: 20 },
  hint: { position: 'absolute', top: '50%', marginTop: 150, left: 32, right: 32, color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
