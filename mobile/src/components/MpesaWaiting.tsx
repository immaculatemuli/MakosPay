import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Text } from 'react-native';
import { displayPhone, kes } from '@/lib/format';
import type { MpesaPayment } from '@/lib/types';
import { Card, colors } from './ui';

/** "Check your phone" while M-Pesa waits for the PIN, then the outcome. */
export function MpesaWaiting({
  payment,
  timedOut,
  successTitle,
  successText,
  waitingText,
}: {
  payment: MpesaPayment;
  timedOut: boolean;
  successTitle: string;
  successText: string;
  waitingText: string;
}) {
  const done = payment.status === 'completed';
  const failed = payment.status === 'failed';
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      {done && <Ionicons name="checkmark-circle" size={64} color={colors.primary} />}
      {failed && <Ionicons name="close-circle" size={64} color={colors.danger} />}
      {!done && !failed && <ActivityIndicator size="large" color={colors.primary} />}
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 12, textAlign: 'center' }}>
        {done ? successTitle : failed ? 'Payment not completed' : 'Check your phone'}
      </Text>
      <Text style={{ color: colors.muted, marginTop: 8, textAlign: 'center' }}>
        {done
          ? `${successText}${payment.mpesa_receipt ? `\nM-Pesa receipt ${payment.mpesa_receipt}` : ''}`
          : failed
            ? (payment.result_desc ?? 'M-Pesa did not complete the payment. No money was taken.')
            : timedOut
              ? 'No answer from M-Pesa yet. If you entered your PIN, it will go through shortly. You can close this screen.'
              : `Enter your M-Pesa PIN on ${displayPhone(payment.phone)} to pay ${kes(payment.amount)}.\n${waitingText}`}
      </Text>
    </Card>
  );
}
