import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { Button, ErrorBox, Field, Muted, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CREW, crewRole } from '@/lib/crew';

/** The SACCO office creates a conductor or driver account (?role=); they then sign in with this phone and password. */
export default function CrewForm() {
  const role = crewRole(useLocalSearchParams<{ role?: string }>().role);
  const words = CREW[role];
  const navigation = useNavigation();
  useLayoutEffect(() => navigation.setOptions({ title: `New ${words.one}` }), [navigation, words.one]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/${words.path}`, { method: 'POST', body: { name: name.trim(), phone: phone.trim(), password } });
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
      <Button title={`Create ${words.one}`} onPress={save} loading={busy} disabled={name.trim().length < 2 || !phone.trim() || password.length < 6} />
      <Muted center>
        {words.onVehicle
          ? `To put them on a vehicle, open the vehicle and choose them as its ${words.one}.`
          : 'They sign in to the FarePay app and see the queues of booked passengers at the stage.'}
      </Muted>
    </Screen>
  );
}
