import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, colors, KeyValue, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import type { TicketParams } from '@/lib/ticket';

/** The ticket the passenger shows to the conductor. */
export default function Ticket() {
  const p = useLocalSearchParams<TicketParams>();
  const refunded = p.refunded === '1';
  const done = () => (router.canGoBack() ? router.back() : router.replace('/passenger'));

  return (
    <Screen>
      <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
        <Ionicons name={refunded ? 'return-down-back' : 'checkmark-circle'} size={64} color={refunded ? colors.danger : colors.primary} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 }}>
          {refunded ? 'Refunded to your wallet' : 'Paid'}
        </Text>
        {refunded && !!p.reason && <Text style={{ color: colors.muted, marginTop: 4 }}>{p.reason}</Text>}
        <Text style={{ color: colors.muted, marginTop: 16 }}>Ticket code</Text>
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
        {!refunded && <Text style={{ color: colors.muted, marginTop: 4 }}>Show this code to the conductor</Text>}
      </Card>

      <Card>
        <KeyValue label="Vehicle" value={p.plate} />
        <KeyValue label="Route" value={p.route} />
        {!!p.stop && <KeyValue label="Getting off at" value={p.stop} />}
        <KeyValue label="Fare" value={kes(Number(p.fare))} />
        {Number(p.saved) > 0 && <KeyValue label="You saved" value={`${kes(Number(p.saved))} vs cash`} />}
        <KeyValue label="Time" value={p.at ? dateTime(p.at) : ''} />
        {p.balance !== undefined && <KeyValue label="Wallet balance" value={kes(Number(p.balance))} />}
      </Card>
      <View style={{ height: 8 }} />
      <Button title="Done" onPress={done} />
    </Screen>
  );
}
