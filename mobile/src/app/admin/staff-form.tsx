import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorBox, Field, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { passwordHint, passwordOk } from '@/lib/password';

/** Add another SACCO office account. They sign in with this phone and password. */
export default function StaffForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/staff', { method: 'POST', body: { name: name.trim(), phone: phone.trim(), password } });
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field label="Full name" value={name} onChangeText={setName} />
      <Field label="Phone number" placeholder="07XX XXX XXX" keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint="They sign in with this number" />
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} hint={`${passwordHint(password)}. They can change it after signing in.`} />
      {error && <ErrorBox message={error} />}
      <Button title="Create office account" onPress={save} loading={busy} disabled={name.trim().length < 2 || !phone.trim() || !passwordOk(password)} />
    </Screen>
  );
}
