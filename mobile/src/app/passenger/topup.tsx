import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { MpesaWaiting } from '@/components/MpesaWaiting';
import { Button, Chips, ErrorBox, Field, Loading, Muted, Screen } from '@/components/ui';
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
          successTitle={`${kes(payment.amount)} added`}
          successText={`New wallet balance: ${kes(mpesa.state?.wallet_balance ?? 0)}`}
          waitingText="Your wallet is topped up as soon as M-Pesa confirms. You can close this screen."
        />
        {payment.status === 'failed' && <Button title="Try again" onPress={mpesa.reset} />}
        <Button title={finished ? 'Done' : 'Close'} variant={payment.status === 'completed' ? 'primary' : 'secondary'} onPress={() => router.back()} />
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
      <Chips label="Amount" options={PRESETS.map((n) => ({ value: String(n), label: kes(n) }))} value={amount} onChange={setAmount} />
      <Field
        label="Or enter an amount (KES)"
        keyboardType="number-pad"
        value={amount}
        onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
        hint={w ? `Between ${kes(w.min_topup)} and ${kes(w.max_topup)}` : undefined}
      />
      <Field label="M-Pesa number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint="The PIN prompt goes to this phone" />
      {error && <ErrorBox message={error} />}
      <Button title={valid ? `Top up ${kes(value)}` : 'Top up'} icon="phone-portrait-outline" onPress={submit} loading={busy} disabled={!valid} />
    </Screen>
  );
}
