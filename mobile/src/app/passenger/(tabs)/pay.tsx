import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { WhereGoing } from '@/components/WhereGoing';
import { Button, Card, colors, ErrorBox, KeyValue, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { useChosenStop } from '@/lib/chosenRoute';
import { kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { PassengerSummary } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Pay a fare: confirm where you're going, then scan the QR code inside the vehicle. */
export default function PayTab() {
  const { t } = useT();
  const summary = useApi<PassengerSummary>('/passenger/summary');
  const [pickKey, setPickKey] = useState(0);
  const chosen = useChosenStop(pickKey);
  if (summary.loading && !summary.data) return <Loading />;
  const s = summary.data;
  // The chosen drop-off's fare, if it is one of the passenger's saved or frequent ones.
  const fareInfo = s && chosen ? [...s.saved, ...s.frequent].find((x) => x.stop_id === chosen.stop_id) : undefined;

  return (
    <Screen refreshing={summary.refreshing} onRefresh={summary.refresh}>
      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      <SectionTitle>{t('1. Where are you going?')}</SectionTitle>
      <WhereGoing chosen={chosen} saved={s?.saved ?? []} frequent={s?.frequent ?? []} onChosen={() => setPickKey((k) => k + 1)} />
      {fareInfo && (
        <Card>
          <KeyValue label={t('Fare')} value={kes(fareInfo.app_fare)} />
        </Card>
      )}

      <SectionTitle>{t('2. Scan the QR code in the vehicle')}</SectionTitle>
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('You’ll see the vehicle, route and fare before anything is paid.')}</Text>
      </View>
      <Button title={t('Scan QR code')} icon="qr-code-outline" onPress={() => router.push('/passenger/scan')} />
      {s && <Muted center>{t('Wallet balance {amount}. If it’s too low you can pay with M-Pesa.', { amount: kes(s.balance) })}</Muted>}
    </Screen>
  );
}
