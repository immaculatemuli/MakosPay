import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { Badge, Button, Card, Chips, colors, Empty, ErrorBox, Field, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime, kes, nairobiDate, prettyDate } from '@/lib/format';
import type { FareChange, Route } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const WHEN = [
  { value: 0, label: 'Today' },
  { value: 1, label: 'Tomorrow' },
  { value: 7, label: 'In a week' },
];

const digits = (t: string) => t.replace(/\D/g, '');

/** A route's fare history, and setting the route's new fare from a chosen day (?route_id=). */
export default function FareHistory() {
  const { route_id } = useLocalSearchParams<{ route_id: string }>();
  const route = useApi<Route>(`/admin/routes/${route_id}`);
  const history = useApi<FareChange[]>(`/admin/routes/${route_id}/fare-changes`);
  const [fareText, setFareText] = useState('');
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if ((route.loading && !route.data) || (history.loading && !history.data)) return <Loading />;
  const current = route.data?.fare ?? null;
  const fare = Number(fareText);
  const valid = current !== null && fare > 0;
  const date = nairobiDate(days);

  const save = () =>
    Alert.alert(
      `New fare for ${route.data?.name}`,
      `Fare ${kes(fare)}, ${days === 0 ? 'starting now' : `from ${prettyDate(date)}`}. Payments already made keep their fares.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/admin/routes/${route_id}/fare-change`, {
                method: 'POST',
                body: { fare, effective_date: date, ...(reason.trim() && { reason: reason.trim() }) },
              });
              setFareText('');
              setReason('');
              await Promise.all([route.reload(), history.reload()]);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );

  const cancel = (c: FareChange) =>
    Alert.alert('Cancel this fare change?', `${kes(c.new_app_fare)} from ${dateTime(c.effective_from)}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel change',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(`/admin/fare-changes/${c.id}/cancel`, { method: 'POST' });
            await history.reload();
          } catch (err) {
            Alert.alert('Could not cancel', errorMessage(err));
          }
        },
      },
    ]);

  return (
    <Screen refreshing={history.refreshing} onRefresh={() => void Promise.all([route.reload(), history.reload()])}>
      {(route.error || history.error) && <ErrorBox message={(route.error ?? history.error)!} />}
      <SectionTitle>Set a new fare</SectionTitle>
      {current !== null && (
        <>
          <Muted>Now {kes(current)} to every stop. The new fare is for the whole route too.</Muted>
          <Field label="New fare" keyboardType="number-pad" value={fareText} onChangeText={(t) => setFareText(digits(t))} />
          <Chips label="Starts" options={WHEN} value={days} onChange={setDays} />
          <Muted>{days === 0 ? 'Starts straight away.' : `Starts at midnight on ${prettyDate(date)}. Passengers can see it coming.`}</Muted>
          <Field label="Reason (optional)" placeholder="e.g. Fuel price rise" value={reason} onChangeText={setReason} />
          {error && <ErrorBox message={error} />}
          <Button title="Set new fare" icon="pricetag-outline" onPress={save} loading={busy} disabled={!valid} />
        </>
      )}

      <SectionTitle>History</SectionTitle>
      {history.data?.length === 0 && <Empty text="No fare changes yet." />}
      {history.data?.map((c) => {
        const waiting = !c.applied_at && !c.cancelled_at;
        return (
          <Card key={c.id}>
            {c.cancelled_at ? (
              <Badge text="Cancelled" tone="neutral" />
            ) : waiting ? (
              <Badge text={`Starts ${dateTime(c.effective_from)}`} tone="warning" />
            ) : (
              <Badge text={`In effect since ${dateTime(c.applied_at!)}`} tone="success" />
            )}
            <Text style={{ color: colors.text, marginTop: 6 }}>
              Fare {kes(c.old_app_fare)} → {kes(c.new_app_fare)}
            </Text>
            <Muted>
              By {c.changed_by_name ?? '—'}
              {c.created_at ? ` on ${dateTime(c.created_at)}` : ''}
              {c.reason ? ` · ${c.reason}` : ''}
            </Muted>
            {waiting && <Button title="Cancel this change" variant="danger" onPress={() => cancel(c)} />}
          </Card>
        );
      })}
    </Screen>
  );
}
