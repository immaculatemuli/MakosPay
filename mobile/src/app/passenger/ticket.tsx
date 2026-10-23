import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, colors, KeyValue, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { TicketParams } from '@/lib/ticket';

/** The ticket the passenger shows to the conductor. */
export default function Ticket() {
  const { t } = useT();
  const p = useLocalSearchParams<TicketParams>();
  const refunded = p.refunded === '1';
  const done = () => (router.canGoBack() ? router.back() : router.replace('/passenger'));

  return (
    <Screen>
      <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
        <Ionicons name={refunded ? 'return-down-back' : 'checkmark-circle'} size={64} color={refunded ? colors.danger : colors.primary} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 }}>
          {refunded ? t('Refunded to your wallet') : p.free === '1' ? t('Free ride') : t('Paid')}
        </Text>
        {refunded && !!p.reason && <Text style={{ color: colors.muted, marginTop: 4 }}>{p.reason}</Text>}
        <Text style={{ color: colors.muted, marginTop: 16 }}>{t('Ticket code')}</Text>
        <Text
          selectable
          style={{
            fontSize: 44,
            fontWeight: '800',
            letterSpacing: 6,
            color: refunded ? colors.muted : colors.text,
            textDecorationLine: refunded ? 'line-through' : 'none',
          }}
        >
          {p.code}
        </Text>
        {!refunded && <Text style={{ color: colors.muted, marginTop: 4 }}>{t('Show this code to the conductor')}</Text>}
      </Card>

      <Card>
        <KeyValue label={t('Vehicle')} value={p.plate} />
        <KeyValue label={t('Route')} value={p.route} />
        {!!p.stop && <KeyValue label={t('Getting off at')} value={p.stop} />}
        <KeyValue label={t('Fare')} value={p.free === '1' ? t('{amount} · free, paid by the SACCO', { amount: kes(Number(p.fare)) }) : kes(Number(p.fare))} />
        <KeyValue label={t('Time')} value={p.at ? dateTime(p.at) : ''} />
        {p.balance !== undefined && <KeyValue label={t('Wallet balance')} value={kes(Number(p.balance))} />}
      </Card>
      <View style={{ height: 8 }} />
      <Button title={t('Done')} onPress={done} />
      {!!p.id && (
        <Button
          title={t('Report a problem with this payment')}
          variant="secondary"
          icon="chatbox-ellipses-outline"
          onPress={() => router.push({ pathname: '/passenger/report', params: { trip_id: p.id, ticket: p.code, plate: p.plate } })}
        />
      )}
    </Screen>
  );
}
