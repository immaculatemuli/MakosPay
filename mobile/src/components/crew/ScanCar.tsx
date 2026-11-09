import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { QrScanner } from '@/components/QrScanner';
import { Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * "I'm working on this car today": the conductor or driver scans the FarePay sticker inside the car and takes their
 * place on it. Whoever had that place is told, and the office sees every move.
 */
export function ScanCar() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  const claim = async (qr: string) => {
    setBusy(true);
    try {
      const res = await api<{ plate: string; changed: boolean; left?: string | null }>('/crew/vehicle/claim', { method: 'POST', body: { qr } });
      Alert.alert(
        res.changed ? t('You are on {plate}', { plate: res.plate }) : t('You are already on {plate}', { plate: res.plate }),
        res.left ? t('You are no longer on {plate}.', { plate: res.left }) : undefined,
      );
      router.back();
    } catch (err) {
      // Not a car's sticker, or the old car is still taking bookings: say why, then scan again.
      Alert.alert(t('Could not switch car'), errorMessage(err), [{ text: t('OK'), onPress: () => router.back() }]);
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Loading />;
  return <QrScanner onCode={(qr) => void claim(qr)} />;
}
