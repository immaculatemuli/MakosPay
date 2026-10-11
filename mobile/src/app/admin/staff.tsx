import { router } from 'expo-router';
import { Alert } from 'react-native';
import { Badge, Button, ErrorBox, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import type { Staff } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** SACCO office accounts: everyone who can manage routes, vehicles, payments and payouts. */
export default function StaffList() {
  const { user } = useAuth();
  const { data, error, loading, refreshing, refresh, reload } = useApi<Staff[]>('/admin/staff');
  if (loading && !data) return <Loading />;

  const manage = (s: Staff) => {
    if (s.id === user?.id) return Alert.alert('This is you', 'You cannot switch off your own account.');
    Alert.alert(s.name, displayPhone(s.phone), [
      { text: 'Close', style: 'cancel' },
      {
        text: s.is_active ? 'Switch off account' : 'Switch on account',
        style: s.is_active ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await api(`/admin/staff/${s.id}`, { method: 'PATCH', body: { is_active: !s.is_active } });
            await reload();
          } catch (err) {
            Alert.alert('Could not update', errorMessage(err));
          }
        },
      },
    ]);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Muted>Everyone here can manage routes, vehicles, payments and payouts. Only add people you trust.</Muted>
      <Button title="Add office account" icon="person-add-outline" onPress={() => router.push('/admin/staff-form')} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!!data?.length && (
        <List>
          {data.map((s) => (
            <ListRow
              key={s.id}
              icon="briefcase-outline"
              title={s.id === user?.id ? `${s.name} (you)` : s.name}
              subtitle={displayPhone(s.phone)}
              rightSub={s.is_active ? undefined : <Badge text="Switched off" tone="danger" />}
              onPress={() => manage(s)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
