import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { AuthForm } from '@/components/AuthForm';
import { Button, colors, ErrorBox, Field } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function Register() {
  const { user, register } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), phone.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthForm subtitle="Create your passenger account">
      {error && <ErrorBox message={error} />}
      <Field label="Full name" autoComplete="name" value={name} onChangeText={setName} />
      <Field
        label="M-Pesa phone number"
        placeholder="07XX XXX XXX"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
      />
      <Field label="Password" hint="At least 6 characters" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
      <Button title="Create account" onPress={submit} loading={busy} disabled={name.trim().length < 2 || !phone || password.length < 6} />
      <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 13 }}>
        By creating an account you agree to our{' '}
        <Text style={{ color: colors.primary, fontWeight: '600' }} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          privacy policy
        </Text>
        .
      </Text>
      <Link href="/sign-in" style={{ textAlign: 'center', marginTop: 12, padding: 8 }}>
        <Text style={{ color: colors.muted }}>
          Already have an account? <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Text>
        </Text>
      </Link>
    </AuthForm>
  );
}
