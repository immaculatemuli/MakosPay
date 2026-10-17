import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useLayoutEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CREW, crewRole } from '@/lib/crew';
import { displayPhone } from '@/lib/format';
import type { Conductor } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Conductors or drivers (?role=conductor|driver): add, set a new password, switch off, delete. */
export default function CrewList() {
  const role = crewRole(useLocalSearchParams<{ role?: string }>().role);
  const words = CREW[role];
  const navigation = useNavigation();
  useLayoutEffect(() => navigation.setOptions({ title: words.many }), [navigation, words.many]);
  const { data, error, loading, refreshing, refresh, reload } = useApi<Conductor[]>(`/admin/${words.path}`);
  if (loading && !data) return <Loading />;

  const remove = (c: Conductor) =>
    Alert.alert(
      `Delete ${c.name}?`,
      `Their account, name and phone number are removed from FarePay${c.vehicle_plate ? ` and they are taken off ${c.vehicle_plate}` : ''}. Payments and trips they worked stay in the records as "Deleted ${words.one}". This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api(`/admin/${words.path}/${c.id}/delete`, { method: 'POST' });
              await reload();
            } catch (err) {
              Alert.alert('Could not delete', errorMessage(err));
            }
          },
        },
      ],
    );

  // Android shows at most 3 buttons, so there it closes by tapping outside (or Back) instead of a Close button.
  const manage = (c: Conductor) =>
    Alert.alert(c.name, `${displayPhone(c.phone)}\n${c.vehicle_plate ? `Works on ${c.vehicle_plate}` : 'Not on a vehicle'}`, [
      ...(Platform.OS === 'ios' ? [{ text: 'Close', style: 'cancel' as const }] : []),
      { text: 'Set new password', onPress: () => router.push({ pathname: '/admin/set-password', params: { id: c.id, name: c.name, phone: c.phone } }) },
      {
        text: c.is_active ? 'Switch off account' : 'Switch on account',
        style: c.is_active ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await api(`/admin/${words.path}/${c.id}`, { method: 'PATCH', body: { is_active: !c.is_active } });
            await reload();
          } catch (err) {
            Alert.alert('Could not update', errorMessage(err));
          }
        },
      },
      { text: 'Delete…', style: 'destructive', onPress: () => remove(c) },
    ], { cancelable: true });

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title={`Add ${words.one}`} icon="person-add-outline" onPress={() => router.push({ pathname: '/admin/crew-form', params: { role } })} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.length === 0 && <Empty text={`No ${words.many.toLowerCase()} yet.`} />}
      {!!data?.length && (
        <List>
          {data.map((c) => (
            <ListRow
              key={c.id}
              icon={words.icon}
              title={c.name}
              subtitle={`${displayPhone(c.phone)} · ${c.vehicle_plate ?? 'Not on a vehicle'}`}
              rightSub={c.is_active ? undefined : <Badge text="Switched off" tone="danger" />}
              onPress={() => manage(c)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
