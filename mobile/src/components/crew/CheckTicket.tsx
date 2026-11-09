import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, colors, ErrorBox, Field, KeyValue, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Trip } from '@/lib/types';

/** Type the ticket code a passenger shows to confirm they paid on this vehicle. */
export function CheckTicket() {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ is_today: boolean; refunded: boolean; payment: Trip } | null>(null);
  const valid = result && result.is_today && !result.refunded;

  const check = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api(`/crew/tickets/${encodeURIComponent(code.trim())}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field
        label={t('Ticket code')}
        placeholder={t('6 letters and numbers')}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        value={code}
        onChangeText={(typed) => {
          setCode(typed.toUpperCase());
          setResult(null);
          setError(null);
        }}
        onSubmitEditing={check}
        style={{ fontSize: 24, letterSpacing: 4, textAlign: 'center' }}
      />
      <Button title={t('Check')} icon="search" onPress={check} loading={busy} disabled={code.trim().length !== 6} />
      {error && <ErrorBox message={error} />}
      {result && (
        <Card>
          <Ionicons
            name={valid ? 'checkmark-circle' : 'alert-circle'}
            size={56}
            color={valid ? colors.primary : result.refunded ? colors.danger : colors.warning}
            style={{ alignSelf: 'center' }}
          />
          <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center', color: colors.text, marginVertical: 8 }}>
            {result.refunded ? t('Refunded: not valid') : result.is_today ? t('Paid') : t('Paid, but not today')}
          </Text>
          <KeyValue label={t('Passenger')} value={result.payment.passenger_name ?? ''} />
          <KeyValue label={t('Phone')} value={result.payment.passenger_phone ?? ''} />
          <KeyValue label={t('Getting off at')} value={result.payment.stop_name ?? result.payment.route_name} />
          <KeyValue label={t('Fare')} value={kes(result.payment.fare)} />
          <KeyValue label={t('Paid at')} value={dateTime(result.payment.created_at)} />
        </Card>
      )}
    </Screen>
  );
}
