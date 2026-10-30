import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, colors, ErrorBox, Field, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Route } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const digits = (t: string) => t.replace(/\D/g, '');

interface StopDraft {
  key: string;
  id?: number;
  name: string;
}

let nextKey = 1;
const blankStop = (): StopDraft => ({ key: `new-${nextKey++}`, name: '' });

const stopProblem = (s: StopDraft) => (s.name.trim().length < 2 ? 'Enter the stop name' : null);

/** Add a route (no id), or edit one (?id=): its name, starting point, its one fare and its drop-off stops. */
export default function RouteForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const route = useApi<Route>(id ? `/admin/routes/${id}` : null);
  const existing = route.data;
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [fare, setFare] = useState('');
  const [stops, setStops] = useState<StopDraft[]>([blankStop()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!existing || prefilled.current) return;
    prefilled.current = true;
    setName(existing.name);
    setOrigin(existing.origin);
    setFare(existing.fare ? String(existing.fare) : '');
    setStops(existing.stops.map((s) => ({ key: `id-${s.id}`, id: s.id, name: s.name })));
  }, [existing]);

  if (id && route.loading && !existing) return <Loading />;

  const update = (key: string, change: Partial<StopDraft>) => setStops((all) => all.map((s) => (s.key === key ? { ...s, ...change } : s)));
  const remove = (key: string) => setStops((all) => all.filter((s) => s.key !== key));
  const move = (index: number, by: number) =>
    setStops((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });

  const names = stops.map((s) => s.name.trim().toLowerCase());
  const duplicate = names.some((n, i) => n && names.indexOf(n) !== i);
  const valid = name.trim().length >= 2 && origin.trim().length >= 2 && Number(fare) > 0 && stops.length > 0 && stops.every((s) => !stopProblem(s)) && !duplicate;

  const save = async (extra: { is_active?: boolean } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        origin: origin.trim(),
        fare: Number(fare),
        stops: stops.map((s) => ({ ...(s.id && { id: s.id }), name: s.name.trim() })),
        ...extra,
      };
      await api(id ? `/admin/routes/${id}` : '/admin/routes', { method: id ? 'PATCH' : 'POST', body });
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {route.error && <ErrorBox message={route.error} onRetry={route.reload} />}
      {existing && !existing.is_active && <Notice>This route is not in use. Passengers can’t pay on it.</Notice>}
      <Field label="Route name" placeholder="e.g. Thika Road" value={name} onChangeText={setName} />
      <Field label="Starts from" placeholder="e.g. Town" value={origin} onChangeText={setOrigin} />
      <Field label="Fare (KES)" placeholder="e.g. 200" keyboardType="number-pad" value={fare} onChangeText={(t) => setFare(digits(t))} />
      <Muted>
        One fixed fare for the whole route: passengers pay it wherever they get off.
        {id ? ' A fare changed here starts straight away; to start a new fare on a later day, use Fare history.' : ''}
      </Muted>

      <SectionTitle>Drop-off stops</SectionTitle>
      <Muted>Add each place passengers can get off, in order along the route.</Muted>
      {id && (
        <Button
          title="Fare history and future fares"
          variant="secondary"
          icon="time-outline"
          onPress={() => router.push({ pathname: '/admin/fare-history', params: { route_id: id } })}
        />
      )}
      <View style={{ height: 10 }} />

      {stops.map((s, index) => {
        const problem = s.name && stopProblem(s);
        return (
          <Card key={s.key}>
            <View style={styles.stopHeader}>
              <Text style={styles.stopNumber}>Stop {index + 1}</Text>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                {index > 0 && (
                  <Pressable onPress={() => move(index, -1)} hitSlop={8} accessibilityLabel="Move up">
                    <Ionicons name="arrow-up" size={20} color={colors.muted} />
                  </Pressable>
                )}
                {index < stops.length - 1 && (
                  <Pressable onPress={() => move(index, 1)} hitSlop={8} accessibilityLabel="Move down">
                    <Ionicons name="arrow-down" size={20} color={colors.muted} />
                  </Pressable>
                )}
                {stops.length > 1 && (
                  <Pressable onPress={() => remove(s.key)} hitSlop={8} accessibilityLabel="Remove stop">
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                )}
              </View>
            </View>
            <TextInput style={styles.input} placeholder="Stop name, e.g. Athi River" placeholderTextColor="#9CA3AF" value={s.name} onChangeText={(t) => update(s.key, { name: t })} />
            {problem ? <Text style={{ color: colors.danger, fontSize: 13 }}>{problem}</Text> : null}
          </Card>
        );
      })}
      {duplicate && <ErrorBox message="Two stops have the same name." />}
      <Button title="Add another stop" variant="secondary" icon="add" onPress={() => setStops((all) => [...all, blankStop()])} />

      {error && <ErrorBox message={error} />}
      <Button title={id ? 'Save changes' : 'Add route'} onPress={() => save()} loading={busy} disabled={!valid} />
      {existing && (
        <Button
          title={existing.is_active ? 'Stop using this route' : 'Use this route again'}
          variant={existing.is_active ? 'danger' : 'secondary'}
          onPress={() => save({ is_active: !existing.is_active })}
          disabled={busy || !valid}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  stopNumber: { fontWeight: '700', color: colors.text },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    marginBottom: 8,
  },
});
