import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { AuthForm } from '@/components/AuthForm';
import { Badge, Button, Card, colors, Empty, KeyValue, Loading, Muted } from '@/components/ui';
import { lastPhoneNumber } from '@/lib/auth';
import { dateTime, displayPhone, kes } from '@/lib/format';
import { loadSavedTickets } from '@/lib/savedTickets';
import type { Trip } from '@/lib/types';

/**
 * The tickets saved on this phone for the number that signed in last, without signing in or internet
 * (to show the conductor when there's no signal). Tap one to show its code large.
 */
export default function SavedTickets() {
  const [phone, setPhone] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Trip[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const last = await lastPhoneNumber();
      setPhone(last);
      const saved = await loadSavedTickets(last);
      setTickets(saved);
      setOpen(saved[0]?.id ?? null);
    })();
  }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  return (
    <AuthForm subtitle={phone ? `Tickets saved for ${displayPhone(phone)}` : 'Saved tickets'}>
      {tickets === null && <Loading />}
      {tickets?.length === 0 && <Empty text="No tickets saved on this phone." />}
      {tickets?.map((t) => {
        const refunded = t.status === 'refunded';
        return (
          <Pressable key={t.id} onPress={() => setOpen(open === t.id ? null : t.id)} accessibilityRole="button">
            <Card>
              <Text style={{ fontWeight: '700', color: colors.text }}>
                {t.plate} · to {t.stop_name ?? t.route_name}
              </Text>
              <Muted>
                {dateTime(t.created_at)} · {kes(t.fare)}
              </Muted>
              {refunded && <Badge text="Refunded" tone="danger" />}
              {open === t.id ? (
                <>
                  <Text
                    selectable
                    style={{
                      fontSize: 40,
                      fontWeight: '800',
                      letterSpacing: 6,
                      textAlign: 'center',
                      marginVertical: 12,
                      color: refunded ? colors.muted : colors.text,
                      textDecorationLine: refunded ? 'line-through' : 'none',
                    }}
                  >
                    {t.ticket_code}
                  </Text>
                  <KeyValue label="Route" value={t.route_name} />
                  {!refunded && <Muted center>Show this code to the conductor</Muted>}
                </>
              ) : (
                <Muted>Ticket {t.ticket_code} · tap to show</Muted>
              )}
            </Card>
          </Pressable>
        );
      })}
      <Button title="Back to sign in" variant="secondary" onPress={back} />
    </AuthForm>
  );
}
