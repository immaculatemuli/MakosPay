import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, ErrorBox, Field, KeyValue, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import { passwordHint, passwordOk } from '@/lib/password';

/** For a passenger or conductor who forgot their password: the office sets a new one and tells them. */
export default function SetPassword() {
  const { id, name, phone } = useLocalSearchParams<{ id: string; name: string; phone: string }>();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${id}/password`, { method: 'POST', body: { new_password: password } });
      Alert.alert('Password changed', `Tell ${name} their new password. They can change it after signing in.`, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <KeyValue label="Name" value={name} />
        <KeyValue label="Phone" value={displayPhone(phone ?? null)} />
      </Card>
      <Muted>Only do this after checking it’s really them, for example by calling the number above.</Muted>
      <Field label="New password" secureTextEntry value={password} onChangeText={setPassword} hint={passwordHint(password)} />
      {error && <ErrorBox message={error} />}
      <Button title="Set new password" icon="key-outline" onPress={save} loading={busy} disabled={!passwordOk(password)} />
    </Screen>
  );
}
