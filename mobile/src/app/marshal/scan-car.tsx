import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { QrScanner } from '@/components/QrScanner';
import { Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * A car reached the stage (?route=, origin=): scan the FarePay sticker inside it instead of typing its plate. It starts
 * loading on this route and the first passengers in the queue are put on it (they are told which car to board).
 */
export default function ScanArrivedCar() {
  const { t } = useT();
  const params = useLocalSearchParams<{ route?: string; origin?: string }>();
  const [busy, setBusy] = useState(false);

  const arrived = async (qr: string) => {
    setBusy(true);
    try {
      await api('/marshal/cars/arrived', { method: 'POST', body: { qr, route_id: Number(params.route) } });
      router.back();
    } catch (err) {
      Alert.alert(t('Could not do that'), errorMessage(err), [{ text: t('OK'), onPress: () => router.back() }]);
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Loading />;
  return <QrScanner aimHint={t('Scan the FarePay sticker inside the car that arrived')} onCode={(qr) => void arrived(qr)} />;
}
