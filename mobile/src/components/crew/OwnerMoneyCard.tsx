import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorBox } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useApi } from '@/lib/useApi';

type OwnerMoney = { needs_driver: boolean; waiting: { fares: number; total: number } };

/**
 * Drivers only: the car's FarePay fares wait until the driver taps "Send to owner", then the owner is paid by
 * M-Pesa at once. The conductor never sees this (the server refuses them too).
 */
export function OwnerMoneyCard() {
  const { t } = useT();
  const money = useApi<OwnerMoney>('/crew/owner-money');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!money.data?.needs_driver) return null;
  const { fares, total } = money.data.waiting;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api<{ total: number; payouts: { amount: number }[] }>('/crew/owner-money/send', { method: 'POST' });
      const sent = done.payouts.reduce((sum, p) => sum + p.amount, 0);
      Alert.alert(t('Sent to the owner'), t('{amount} is on its way to the owner by M-Pesa.', { amount: kes(sent || done.total) }));
      void money.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert(t('Send to owner?'), t('{amount} from {n} FarePay fares will be sent to the owner now.', { amount: kes(total), n: fares }), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Send'), onPress: () => void send() },
    ]);

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="send-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.label}>{t('FarePay money for the owner')}</Text>
          <Text style={styles.amount}>{kes(total)}</Text>
          <Text style={styles.sub}>{fares ? t('{n} fares not sent yet', { n: fares }) : t('Everything has been sent')}</Text>
        </View>
      </View>
      {error && <ErrorBox message={error} />}
      {fares > 0 && <Button title={t('Send to owner')} icon="send" onPress={confirm} loading={busy} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  label: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  amount: { fontSize: 24, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
