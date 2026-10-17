import { Link, Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { AuthForm } from '@/components/AuthForm';
import { ServerSetting } from '@/components/ServerSetting';
import { Button, colors, ErrorBox, Field } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { lastPhoneNumber, useAuth } from '@/lib/auth';
import { loadSavedTickets } from '@/lib/savedTickets';

export default function SignIn() {
  const { user, signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  // The app always asks to sign in when it opens; the number used last time is filled in (2547... -> 07...).
  useEffect(() => {
    lastPhoneNumber().then(async (last) => {
      if (last) setPhone((typed) => typed || last.replace(/^254/, '0'));
      setHasSaved((await loadSavedTickets(last)).length > 0);
    });
  }, []);

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
      <Link href={{ pathname: '/forgot-password', params: { phone: phone.trim() } }} style={{ textAlign: 'center', marginTop: 4, padding: 8 }}>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Forgot password?</Text>
      </Link>
      <Link href="/register" style={{ textAlign: 'center', marginTop: 4, padding: 8 }}>
        <Text style={{ color: colors.muted }}>
          New passenger? <Text style={{ color: colors.primary, fontWeight: '700' }}>Create an account</Text>
        </Text>
      </Link>
      {hasSaved && (
        <Link href="/saved-tickets" style={{ textAlign: 'center', marginTop: 4, padding: 8 }}>
          <Text style={{ color: colors.muted }}>
            No internet? <Text style={{ color: colors.primary, fontWeight: '700' }}>Show my saved tickets</Text>
          </Text>
        </Link>
      )}
      <ServerSetting />
    </AuthForm>
  );
}
