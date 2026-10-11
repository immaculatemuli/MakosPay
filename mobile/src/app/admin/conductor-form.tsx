import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorBox, Field, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** The SACCO office creates conductor accounts; the conductor then signs in with this phone and password. */
export default function ConductorForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/conductors', { method: 'POST', body: { name: name.trim(), phone: phone.trim(), password } });
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
      <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} hint="At least 6 characters. They can change it after signing in." />
      {error && <ErrorBox message={error} />}
      <Button title="Create conductor" onPress={save} loading={busy} disabled={name.trim().length < 2 || !phone.trim() || password.length < 6} />
      <Muted center>To put them on a vehicle, open the vehicle and choose them as its conductor.</Muted>
    </Screen>
  );
}
