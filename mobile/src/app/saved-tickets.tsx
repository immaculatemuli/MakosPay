import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { AuthForm } from '@/components/AuthForm';
import { Badge, Button, Card, colors, Empty, KeyValue, Loading, Muted } from '@/components/ui';
import { lastPhoneNumber } from '@/lib/auth';
import { dateTime, displayPhone, kes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { loadSavedTickets } from '@/lib/savedTickets';
import type { Trip } from '@/lib/types';

/**
 * The tickets saved on this phone for the number that signed in last, without signing in or internet
 * (to show the conductor when there's no signal). Tap one to show its code large.
 */
export default function SavedTickets() {
  const { t } = useT();
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
    <AuthForm subtitle={phone ? t('Tickets saved for {phone}', { phone: displayPhone(phone) }) : t('Saved tickets')}>
      {tickets === null && <Loading />}
      {tickets?.length === 0 && <Empty text={t('No tickets saved on this phone.')} />}
      {tickets?.map((ticket) => {
        const refunded = ticket.status === 'refunded';
        return (
          <Pressable key={ticket.id} onPress={() => setOpen(open === ticket.id ? null : ticket.id)} accessibilityRole="button">
            <Card>
              <Text style={{ fontWeight: '700', color: colors.text }}>
                {ticket.plate} · {t('to {place}', { place: ticket.stop_name ?? ticket.route_name })}
              </Text>
              <Muted>
                {dateTime(ticket.created_at)} · {kes(ticket.fare)}
              </Muted>
              {refunded && <Badge text={t('Refunded')} tone="danger" />}
              {open === ticket.id ? (
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
                    {ticket.ticket_code}
                  </Text>
                  <KeyValue label={t('Route')} value={ticket.route_name} />
                  {!refunded && <Muted center>{t('Show this code to the conductor')}</Muted>}
                </>
              ) : (
                <Muted>{t('Ticket {code} · tap to show', { code: ticket.ticket_code })}</Muted>
              )}
            </Card>
          </Pressable>
        );
      })}
      <Button title={t('Back to sign in')} variant="secondary" onPress={back} />
    </AuthForm>
  );
}
