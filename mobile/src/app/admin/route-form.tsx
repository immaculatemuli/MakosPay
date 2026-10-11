import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, colors, ErrorBox, Field, Loading, Muted, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { kes } from '@/lib/format';
import type { Route } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const digits = (t: string) => t.replace(/\D/g, '');

interface StopDraft {
  key: string;
  id?: number;
  name: string;
  cash: string;
  app: string;
}

let nextKey = 1;
const blankStop = (): StopDraft => ({ key: `new-${nextKey++}`, name: '', cash: '', app: '' });

const stopProblem = (s: StopDraft) => {
  const cash = Number(s.cash);
  const app = Number(s.app);
  if (s.name.trim().length < 2) return 'Enter the stop name';
  if (!(cash > 0) || !(app > 0)) return 'Enter both fares';
  if (app > cash) return 'App fare cannot be more than the cash fare';
  return null;
};

/** Add a route (no id), or edit one (?id=): its name, starting point and drop-off stops with their fares. */
export default function RouteForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const route = useApi<Route>(id ? `/admin/routes/${id}` : null);
  const existing = route.data;
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [stops, setStops] = useState<StopDraft[]>([blankStop()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefilled = useRef(false);

  useEffect(() => {
    if (!existing || prefilled.current) return;
    prefilled.current = true;
    setName(existing.name);
    setOrigin(existing.origin);
    setStops(existing.stops.map((s) => ({ key: `id-${s.id}`, id: s.id, name: s.name, cash: String(s.cash_fare), app: String(s.app_fare) })));
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
  const valid = name.trim().length >= 2 && origin.trim().length >= 2 && stops.length > 0 && stops.every((s) => !stopProblem(s)) && !duplicate;

  const save = async (extra: { is_active?: boolean } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        origin: origin.trim(),
        stops: stops.map((s) => ({ ...(s.id && { id: s.id }), name: s.name.trim(), cash_fare: Number(s.cash), app_fare: Number(s.app) })),
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
      {existing && !existing.is_active && <Notice>This route is not in use. Passengers can't pay on it.</Notice>}
      <Field label="Route name" placeholder="e.g. Thika Road" value={name} onChangeText={setName} />
      <Field label="Starts from" placeholder="e.g. Town" value={origin} onChangeText={setOrigin} />

      <SectionTitle>Drop-off stops and fares</SectionTitle>
      <Muted>Add each place passengers can get off, in order along the route. App users pay the app fare.</Muted>
      <View style={{ height: 10 }} />

      {stops.map((s, index) => {
        const problem = (s.name || s.cash || s.app) && stopProblem(s);
        const saving = Number(s.cash) - Number(s.app);
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
            <TextInput style={styles.input} placeholder="Stop name, e.g. Juja" placeholderTextColor="#9CA3AF" value={s.name} onChangeText={(t) => update(s.key, { name: t })} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.small}>Cash fare</Text>
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="KES" placeholderTextColor="#9CA3AF" value={s.cash} onChangeText={(t) => update(s.key, { cash: digits(t) })} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.small}>App fare</Text>
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="KES" placeholderTextColor="#9CA3AF" value={s.app} onChangeText={(t) => update(s.key, { app: digits(t) })} />
              </View>
            </View>
            {problem ? (
              <Text style={{ color: colors.danger, fontSize: 13 }}>{problem}</Text>
            ) : saving > 0 ? (
              <Text style={{ color: colors.primary, fontSize: 13 }}>App users save {kes(saving)}</Text>
            ) : null}
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
  small: { fontSize: 13, color: colors.muted, marginBottom: 4 },
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
