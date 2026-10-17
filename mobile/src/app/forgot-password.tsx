import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthForm } from '@/components/AuthForm';
import { Button, colors, ErrorBox, Field, Muted, Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

/**
 * Forgot password: a 6-digit code is sent by SMS to the phone number; with it, a new password is set and the
 * person is signed in. Every other phone signed in with the old password is signed out.
 */
export default function ForgotPassword() {
  const { user, signIn } = useAuth();
  const { t } = useT();
  const params = useLocalSearchParams<{ phone?: string }>();
  const [phone, setPhone] = useState(params.phone ?? '');
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Redirect href="/" />;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ message: string }>('/auth/password-reset/request', { method: 'POST', body: { phone: phone.trim() } });
      setSent(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setNew = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password-reset/confirm', { method: 'POST', body: { phone: phone.trim(), code: code.trim(), new_password: password } });
      await signIn(phone.trim(), password); // straight into the app
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthForm subtitle={t('Set a new password')}>
      {error && <ErrorBox message={error} />}
      {!sent ? (
        <>
          <Muted>{t('Enter your phone number. We send a 6-digit code to it by SMS.')}</Muted>
          <Field label={t('Phone number')} placeholder="07XX XXX XXX" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} />
          <Button title={t('Send me a code')} icon="chatbubble-ellipses-outline" onPress={sendCode} loading={busy} disabled={phone.trim().length < 9} />
        </>
      ) : (
        <>
          <Notice tone="success">{sent}</Notice>
          <Field
            label={t('Code from the SMS')}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={(typed) => setCode(typed.replace(/\D/g, ''))}
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
          />
          <Field label={t('New password')} hint={t('At least 6 characters')} secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
          <Button title={t('Set new password and sign in')} onPress={setNew} loading={busy} disabled={code.length !== 6 || password.length < 6} />
          <Button title={t('Send a new code')} variant="secondary" onPress={sendCode} disabled={busy} />
        </>
      )}
      <Link href="/sign-in" style={{ textAlign: 'center', marginTop: 12, padding: 8 }}>
        <Text style={{ color: colors.muted }}>
          {t('Remembered it?')} <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('Sign in')}</Text>
        </Text>
      </Link>
    </AuthForm>
  );
}
