import { router } from 'expo-router';
import { Alert } from 'react-native';
import { Badge, Button, Empty, ErrorBox, List, ListRow, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import type { Conductor } from '@/lib/types';
import { useApi } from '@/lib/useApi';

export default function Conductors() {
  const { data, error, loading, refreshing, refresh, reload } = useApi<Conductor[]>('/admin/conductors');
  if (loading && !data) return <Loading />;

  const manage = (c: Conductor) =>
    Alert.alert(c.name, `${displayPhone(c.phone)}\n${c.vehicle_plate ? `Works on ${c.vehicle_plate}` : 'Not on a vehicle'}`, [
      { text: 'Close', style: 'cancel' },
      { text: 'Set new password', onPress: () => router.push({ pathname: '/admin/set-password', params: { id: c.id, name: c.name, phone: c.phone } }) },
      {
        text: c.is_active ? 'Disable account' : 'Enable account',
        style: c.is_active ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await api(`/admin/conductors/${c.id}`, { method: 'PATCH', body: { is_active: !c.is_active } });
            await reload();
          } catch (err) {
            Alert.alert('Could not update', errorMessage(err));
          }
        },
      },
    ]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="Add conductor" icon="person-add-outline" onPress={() => router.push('/admin/conductor-form')} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data?.length === 0 && <Empty text="No conductors yet." />}
      {!!data?.length && (
        <List>
          {data.map((c) => (
            <ListRow
              key={c.id}
              icon="person-outline"
              title={c.name}
              subtitle={`${displayPhone(c.phone)} · ${c.vehicle_plate ?? 'Not on a vehicle'}`}
              rightSub={c.is_active ? undefined : <Badge text="Disabled" tone="danger" />}
              onPress={() => manage(c)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
