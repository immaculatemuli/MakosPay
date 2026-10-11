import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthForm } from '@/components/AuthForm';
import { ServerSetting } from '@/components/ServerSetting';
import { Button, colors, ErrorBox, Field } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const { user, signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(phone.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthForm subtitle="Pay your fare by scanning the QR code">
      {error && <ErrorBox message={error} />}
      <Field label="Phone number" placeholder="07XX XXX XXX" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} />
      <Field label="Password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
      <Button title="Sign in" onPress={submit} loading={busy} disabled={!phone || !password} />
      <Link href="/register" style={{ textAlign: 'center', marginTop: 12, padding: 8 }}>
        <Text style={{ color: colors.muted }}>
          New passenger? <Text style={{ color: colors.primary, fontWeight: '700' }}>Create an account</Text>
        </Text>
      </Link>
      <ServerSetting />
    </AuthForm>
  );
}
