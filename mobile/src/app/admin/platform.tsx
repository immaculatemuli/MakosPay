import { useState } from 'react';
import { Alert } from 'react-native';
import { Badge, Button, Card, ErrorBox, Field, KeyValue, List, ListRow, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { displayPhone, kes } from '@/lib/format';
import type { Staff } from '@/lib/types';
import { useApi } from '@/lib/useApi';

interface SystemStatus {
  payments_by: string;
  live: boolean;
  mpesa_payments_enabled: boolean;
  automatic_payouts_enabled: boolean;
  daily_payout_at: string;
  wallet_limits: { min_topup: number; max_topup: number; max_balance: number };
  counts: { passengers: number; crew: number; office: number; vehicles: number };
}

/** Platform admin only: how money moves right now, and the platform admin accounts. */
export default function Platform() {
  const { user } = useAuth();
  const system = useApi<SystemStatus>('/platform/system');
  const admins = useApi<Staff[]>('/platform/admins');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user?.role !== 'platform_admin') return <Screen><ErrorBox message="Only platform admins can open this page." /></Screen>;
  if (system.loading && !system.data) return <Loading />;
  const s = system.data;

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/platform/admins', { method: 'POST', body: { name: name.trim(), phone: phone.trim(), password } });
      setName('');
      setPhone('');
      setPassword('');
      await admins.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (a: Staff) => {
    if (a.id === user.id) return Alert.alert('This is you', 'You cannot switch off your own account.');
    Alert.alert(a.name, displayPhone(a.phone), [
      { text: 'Close', style: 'cancel' },
      {
        text: a.is_active ? 'Switch off account' : 'Switch on account',
        style: a.is_active ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await api(`/platform/admins/${a.id}`, { method: 'PATCH', body: { is_active: !a.is_active } });
            await admins.reload();
          } catch (err) {
            Alert.alert('Could not update', errorMessage(err));
          }
        },
      },
    ]);
  };

  return (
    <Screen refreshing={system.refreshing} onRefresh={system.refresh}>
      {system.error && <ErrorBox message={system.error} onRetry={system.reload} />}
      {s && (
        <>
          {s.live ? (
            <Notice tone="success">Real money: payments are live.</Notice>
          ) : (
            <Notice>Test mode: no real money moves. Amounts shown are test transactions.</Notice>
          )}
          <Card>
            <KeyValue label="Payments by" value={s.payments_by} />
            <KeyValue label="M-Pesa payments" value={s.mpesa_payments_enabled ? 'On' : 'Not set up'} />
            <KeyValue label="Automatic payouts" value={s.automatic_payouts_enabled ? `On, daily at ${s.daily_payout_at}` : 'Off (office sends them)'} />
            <KeyValue label="Top-up limits" value={`${kes(s.wallet_limits.min_topup)} – ${kes(s.wallet_limits.max_topup)}`} />
            <KeyValue label="Wallet limit" value={kes(s.wallet_limits.max_balance)} />
          </Card>
          <Card>
            <KeyValue label="Passengers" value={String(s.counts.passengers)} />
            <KeyValue label="Conductors and drivers" value={String(s.counts.crew)} />
            <KeyValue label="Office and platform accounts" value={String(s.counts.office)} />
            <KeyValue label="Vehicles in use" value={String(s.counts.vehicles)} />
          </Card>
        </>
      )}

      <SectionTitle>Platform admins</SectionTitle>
      {admins.error && <ErrorBox message={admins.error} onRetry={admins.reload} />}
      {!!admins.data?.length && (
        <List>
          {admins.data.map((a) => (
            <ListRow
              key={a.id}
              icon="shield-checkmark-outline"
              title={a.id === user.id ? `${a.name} (you)` : a.name}
              subtitle={displayPhone(a.phone)}
              rightSub={a.is_active ? undefined : <Badge text="Switched off" tone="danger" />}
              onPress={() => toggle(a)}
            />
          ))}
        </List>
      )}

      <SectionTitle>Add a platform admin</SectionTitle>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field label="Phone number" placeholder="07XX XXX XXX" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} hint="At least 6 characters" />
      {error && <ErrorBox message={error} />}
      <Button title="Add platform admin" icon="person-add-outline" onPress={add} loading={busy} disabled={name.trim().length < 2 || !phone.trim() || password.length < 6} />
    </Screen>
  );
}
