import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { WhereGoing } from '@/components/WhereGoing';
import { Button, Card, colors, ErrorBox, KeyValue, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { useChosenStop } from '@/lib/chosenRoute';
import { kes } from '@/lib/format';
import type { PassengerSummary } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Pay a fare: confirm where you're going, then scan the QR code inside the vehicle. */
export default function PayTab() {
  const summary = useApi<PassengerSummary>('/passenger/summary');
  const [pickKey, setPickKey] = useState(0);
  const chosen = useChosenStop(pickKey);
  if (summary.loading && !summary.data) return <Loading />;
  const s = summary.data;
  // The chosen drop-off's Member Fare, if it is one of the passenger's saved or frequent ones.
  const fareInfo = s && chosen ? [...s.saved, ...s.frequent].find((x) => x.stop_id === chosen.stop_id) : undefined;

  return (
    <Screen refreshing={summary.refreshing} onRefresh={summary.refresh}>
      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      <SectionTitle>1. Where are you going?</SectionTitle>
      <WhereGoing chosen={chosen} saved={s?.saved ?? []} frequent={s?.frequent ?? []} onChosen={() => setPickKey((k) => k + 1)} />
      {fareInfo && (
        <Card>
          <KeyValue label="Cash fare" value={kes(fareInfo.cash_fare)} />
          <KeyValue label="Member Fare" value={kes(fareInfo.app_fare)} />
          {fareInfo.you_save > 0 && <KeyValue label="You save" value={kes(fareInfo.you_save)} />}
        </Card>
      )}

      <SectionTitle>2. Scan the QR code in the vehicle</SectionTitle>
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>You'll see the vehicle, route and fare before anything is paid.</Text>
      </View>
      <Button title="Scan QR code" icon="qr-code-outline" onPress={() => router.push('/passenger/scan')} />
      {s && <Muted center>Wallet balance {kes(s.balance)}. If it's too low you can pay with M-Pesa.</Muted>}
    </Screen>
  );
}
