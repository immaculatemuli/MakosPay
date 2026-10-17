import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Text } from 'react-native';
import { displayPhone, kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
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
  const { t } = useT();
  const done = payment.status === 'completed';
  const failed = payment.status === 'failed';
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      {done && <Ionicons name="checkmark-circle" size={64} color={colors.primary} />}
      {failed && <Ionicons name="close-circle" size={64} color={colors.danger} />}
      {!done && !failed && <ActivityIndicator size="large" color={colors.primary} />}
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 12, textAlign: 'center' }}>
        {done ? successTitle : failed ? t('Payment not completed') : t('Check your phone')}
      </Text>
      <Text style={{ color: colors.muted, marginTop: 8, textAlign: 'center' }}>
        {done
          ? `${successText}${payment.mpesa_receipt ? `\n${t('M-Pesa receipt {code}', { code: payment.mpesa_receipt })}` : ''}`
          : failed
            ? (payment.result_desc ?? t('M-Pesa did not complete the payment. No money was taken.'))
            : timedOut
              ? t('No answer from M-Pesa yet. If you entered your PIN, it will go through shortly. You can close this screen.')
              : `${t('Enter your M-Pesa PIN on {phone} to pay {amount}.', { phone: displayPhone(payment.phone), amount: kes(payment.amount) })}\n${waitingText}`}
      </Text>
    </Card>
  );
}
