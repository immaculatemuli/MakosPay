import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { MpesaWaiting } from '@/components/MpesaWaiting';
import { Button, Chips, ErrorBox, Field, Loading, Muted, Screen } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayPhone, kes } from '@/lib/format';
import type { MpesaResponse } from '@/lib/types';
import { useApi } from '@/lib/useApi';
import { useMpesaPayment } from '@/lib/useMpesaPayment';

const PRESETS = [50, 100, 200, 500, 1000];

/** Add money to the wallet with an M-Pesa PIN prompt. */
export default function Topup() {
  const { user } = useAuth();
  const { t } = useT();
  const params = useLocalSearchParams<{ amount?: string }>();
  const wallet = useApi<{ balance: number; min_topup: number; max_topup: number }>('/passenger/wallet');
  const [amount, setAmount] = useState(params.amount ?? '');
  const [phone, setPhone] = useState(displayPhone(user?.phone ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mpesa = useMpesaPayment();

  if (wallet.loading && !wallet.data) return <Loading />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      mpesa.begin(await api<MpesaResponse>('/passenger/wallet/topup', { method: 'POST', body: { amount: Number(amount), phone: phone.trim() || undefined } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const payment = mpesa.state?.payment;
  if (payment) {
    const finished = payment.status === 'completed' || payment.status === 'failed';
    return (
      <Screen>
        <MpesaWaiting
          payment={payment}
          timedOut={mpesa.timedOut}
          successTitle={t('{amount} added', { amount: kes(payment.amount) })}
          successText={t('New wallet balance: {amount}', { amount: kes(mpesa.state?.wallet_balance ?? 0) })}
          waitingText={t('Your wallet is topped up as soon as M-Pesa confirms. You can close this screen.')}
        />
        {payment.status === 'failed' && <Button title={t('Try again')} onPress={mpesa.reset} />}
        <Button title={finished ? t('Done') : t('Close')} variant={payment.status === 'completed' ? 'primary' : 'secondary'} onPress={() => router.back()} />
      </Screen>
    );
  }

  const w = wallet.data;
  const value = Number(amount);
  const valid = Number.isInteger(value) && value > 0 && (!w || (value >= w.min_topup && value <= w.max_topup));

  return (
    <Screen>
      {wallet.error && <ErrorBox message={wallet.error} onRetry={wallet.reload} />}
      {w && <Muted>Current balance {kes(w.balance)}</Muted>}
      <View style={{ height: 12 }} />
      <Chips label={t('Amount')} options={PRESETS.map((n) => ({ value: String(n), label: kes(n) }))} value={amount} onChange={setAmount} />
      <Field
        label={t('Or enter an amount (KES)')}
        keyboardType="number-pad"
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
        hint={w ? t('Between {min} and {max}', { min: kes(w.min_topup), max: kes(w.max_topup) }) : undefined}
      />
      <Field label={t('M-Pesa number')} keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint={t('The PIN prompt goes to this phone')} />
      {error && <ErrorBox message={error} />}
      <Button title={valid ? t('Top up {amount}', { amount: kes(value) }) : t('Top up')} icon="phone-portrait-outline" onPress={submit} loading={busy} disabled={!valid} />
    </Screen>
  );
}
