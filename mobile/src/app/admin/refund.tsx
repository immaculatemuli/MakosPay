import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, ErrorBox, Field, KeyValue, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes } from '@/lib/format';

/** Refund one fare to the passenger's wallet (vehicle broke down, charged twice...). */
export default function Refund() {
  const p = useLocalSearchParams<{ id: string; passenger: string; plate: string; stop: string; fare: string; ticket: string; paidOut: string }>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fare = kes(Number(p.fare));

  const refund = () =>
    Alert.alert(`Refund ${fare}?`, `${fare} goes back to ${p.passenger}'s FarePay wallet. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Refund',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/admin/payments/${p.id}/refund`, { method: 'POST', body: { reason: reason.trim() } });
            router.back();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <Screen>
      <Card>
        <KeyValue label="Passenger" value={p.passenger} />
        <KeyValue label="Vehicle" value={p.plate} />
        <KeyValue label="Getting off at" value={p.stop} />
        <KeyValue label="Ticket" value={p.ticket} />
        <KeyValue label="Fare" value={fare} />
      </Card>
      <Muted>
        {p.paidOut === '1'
          ? 'The owner has already been paid this fare, so it will be taken off their next payout.'
          : 'The owner has not been paid this fare yet, so it will be left out of their payout.'}
      </Muted>
      <Field label="Reason" placeholder="e.g. Vehicle broke down" value={reason} onChangeText={setReason} hint="The passenger sees this in their wallet history" />
      {error && <ErrorBox message={error} />}
      <Button title={`Refund ${fare} to the passenger`} variant="danger" icon="return-down-back-outline" onPress={refund} loading={busy} disabled={reason.trim().length < 3} />
    </Screen>
  );
}
