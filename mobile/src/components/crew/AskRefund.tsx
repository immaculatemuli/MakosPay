import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chips, ErrorBox, Field, KeyValue, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes, time } from '@/lib/format';
import { useT } from '@/lib/i18n';

// Sent in English: the office reads them. Shown in the crew's language.
const REASONS = ['Paid on the wrong car', 'Paid twice', 'Did not travel', 'Paid for the wrong stop', 'Other'] as const;

/**
 * "Paid by mistake": the conductor or driver asks the SACCO office to refund a payment on their car. The crew never
 * move money: the office refunds it (wallet, or M-Pesa for passengers without the app) or says why not.
 */
export function AskRefund() {
  const { t } = useT();
  const p = useLocalSearchParams<{ id: string; ticket: string; fare: string; who: string; at: string; stop: string }>();
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extra = details.trim();
  const text = reason === 'Other' ? extra : [reason, extra].filter(Boolean).join(': ');
  const ready = reason !== null && text.length >= 3;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/crew/payments/${p.id}/refund-request`, { method: 'POST', body: { reason: text } });
      Alert.alert(t('Sent to the office'), t('The SACCO office will check and refund the passenger, or tell you why not.'));
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <KeyValue label={t('Passenger')} value={p.who || t('Passenger')} />
        <KeyValue label={t('Paid')} value={`${kes(Number(p.fare))} · ${p.at ? time(p.at) : ''}`} />
        {!!p.stop && <KeyValue label={t('To')} value={p.stop} />}
        <KeyValue label={t('Ticket')} value={p.ticket} />
      </Card>

      <SectionTitle>{t('What went wrong?')}</SectionTitle>
      <Chips options={REASONS.map((r) => ({ value: r, label: t(r) }))} value={reason} onChange={setReason} />
      <Field
        label={reason === 'Other' ? t('What happened?') : t('More details (optional)')}
        value={details}
        onChangeText={setDetails}
        maxLength={150}
        multiline
      />
      {error && <ErrorBox message={error} />}
      <Button title={t('Ask the office to refund')} icon="return-down-back-outline" onPress={send} loading={busy} disabled={!ready} />
      <Muted center>{t('Only the SACCO office can refund. You will get a notification when they decide.')}</Muted>
    </Screen>
  );
}
