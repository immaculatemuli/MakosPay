import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Field, List, ListRow, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, displayPhone, kes } from '@/lib/format';
import type { Withdrawal } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';

interface Info {
  balance: number;
  phone: string;
  min_amount: number;
  per_day: number;
  withdrawals: Withdrawal[];
}

const STATUS: Record<Withdrawal['status'], { text: string; tone: 'success' | 'warning' | 'danger' }> = {
  processing: { text: 'Sending', tone: 'warning' },
  manual: { text: 'Being sent by the SACCO', tone: 'warning' },
  completed: { text: 'Sent', tone: 'success' },
  failed: { text: 'Not sent, money returned', tone: 'danger' },
};

/** Send wallet money back to the passenger's own M-Pesa number (e.g. before deleting the account). */
export default function Withdraw() {
  const { t } = useT();
  const info = useApi<Info>('/passenger/withdrawals');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (info.loading && !info.data) return <Loading />;
  const d = info.data;
  if (!d) return <Screen><ErrorBox message={info.error ?? t('Could not load your wallet.')} onRetry={info.reload} /></Screen>;

  const value = Number(amount);
  const open = d.withdrawals.find((w) => w.status === 'processing' || w.status === 'manual');
  const valid = Number.isInteger(value) && value >= d.min_amount && value <= d.balance && !open;

  const send = () =>
    Alert.alert(t('Withdraw {amount}?', { amount: kes(value) }), t('It will be sent to your M-Pesa number {phone}.', { phone: displayPhone(d.phone) }), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Withdraw'),
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ withdrawal: Withdrawal; balance: number }>('/passenger/withdrawals', { method: 'POST', body: { amount: value } });
            setAmount('');
            await info.reload();
            Alert.alert(
              r.withdrawal.status === 'completed' ? t('Sent') : r.withdrawal.status === 'failed' ? t('Not sent') : t('On its way'),
              r.withdrawal.status === 'completed'
                ? t('{amount} was sent to your M-Pesa. Code {code}.', { amount: kes(value), code: r.withdrawal.reference ?? '' })
                : r.withdrawal.status === 'failed'
                  ? `${r.withdrawal.result_desc ?? t('M-Pesa could not send it')}. ${t('The money is back in your wallet.')}`
                  : t('We’ll let you know under the bell when it reaches your M-Pesa.'),
            );
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <Screen refreshing={info.refreshing} onRefresh={info.refresh}>
      <Card style={{ alignItems: 'center', paddingVertical: 20 }}>
        <Text style={{ color: colors.muted }}>{t('You can withdraw')}</Text>
        <Text style={{ fontSize: 32, fontWeight: '800', color: colors.text }}>{kes(d.balance)}</Text>
        <Muted center>To your M-Pesa number {displayPhone(d.phone)}</Muted>
      </Card>

      {open ? (
        <Notice>Your withdrawal of {kes(open.amount)} is still being sent. You can withdraw again once it is done.</Notice>
      ) : d.balance < d.min_amount ? (
        <Notice>The smallest withdrawal is {kes(d.min_amount)}.</Notice>
      ) : (
        <>
          <Field
            label={t('Amount (KES)')}
            keyboardType="number-pad"
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
            hint={t('Between {min} and {max}. Up to {n} withdrawals a day.', { min: kes(d.min_amount), max: kes(d.balance), n: d.per_day })}
          />
          <Button title={t('Withdraw everything')} variant="secondary" onPress={() => setAmount(String(d.balance))} />
          {error && <ErrorBox message={error} />}
          <Button title={valid ? t('Withdraw {amount}', { amount: kes(value) }) : t('Withdraw')} icon="arrow-up-circle-outline" onPress={send} loading={busy} disabled={!valid} />
        </>
      )}
      <Muted>{t('Money only goes to the number you signed up with. If it can’t be sent, it comes straight back into your wallet.')}</Muted>

      <SectionTitle>{t('Your withdrawals')}</SectionTitle>
      {d.withdrawals.length === 0 ? (
        <Empty text={t('No withdrawals yet.')} />
      ) : (
        <List>
          {d.withdrawals.map((w) => (
            <ListRow
              key={w.id}
              icon="arrow-up-circle-outline"
              title={kes(w.amount)}
              subtitle={`${dateTime(w.created_at)}${w.reference ? ` · M-Pesa ${w.reference}` : ''}${w.status === 'failed' && w.result_desc ? ` · ${w.result_desc}` : ''}`}
              rightSub={<Badge text={t(STATUS[w.status].text)} tone={STATUS[w.status].tone} />}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
