import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chips, ErrorBox, Field, KeyValue, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { REPORT_CATEGORY_LABEL, type ReportCategory } from '@/lib/types';

const CATEGORIES = Object.entries(REPORT_CATEGORY_LABEL).map(([value, label]) => ({ value: value as ReportCategory, label }));

/** Tell the SACCO office about a problem, optionally about one payment (?trip_id=, ticket, plate). */
export default function Report() {
  const p = useLocalSearchParams<{ trip_id?: string; ticket?: string; plate?: string }>();
  const [category, setCategory] = useState<ReportCategory>(p.trip_id ? 'payment_problem' : 'other');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/passenger/reports', {
        method: 'POST',
        body: { category, message: message.trim(), ...(p.trip_id && { trip_id: Number(p.trip_id) }) },
      });
      Alert.alert('Report sent', 'The SACCO office will look into it. You can see their reply under Profile → My reports.', [
        { text: 'OK', onPress: () => router.replace('/passenger/reports') },
      ]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {p.trip_id && (
        <Card>
          <KeyValue label="About payment" value={`${p.ticket ?? ''}${p.plate ? ` · ${p.plate}` : ''}`} />
        </Card>
      )}
      <Chips label="What went wrong?" options={CATEGORIES} value={category} onChange={setCategory} />
      <Field
        label="Tell us what happened"
        value={message}
        onChangeText={setMessage}
        multiline
        style={{ minHeight: 110, textAlignVertical: 'top' }}
        hint="For example: which vehicle, what time, and how much you were charged"
      />
      {error && <ErrorBox message={error} />}
      <Button title="Send report" icon="send-outline" onPress={send} loading={busy} disabled={message.trim().length < 5} />
      <Muted center>Never share your M-Pesa PIN or FarePay password. The SACCO office will never ask for them.</Muted>
    </Screen>
  );
}
