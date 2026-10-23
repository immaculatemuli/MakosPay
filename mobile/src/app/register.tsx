import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { AuthForm } from '@/components/AuthForm';
import { Button, colors, ErrorBox, Field, Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

/**
 * Sign up in two steps: name, number and password, then the 6-digit code sent to that number by SMS (it proves
 * the number is theirs). A server with no SMS says no code is needed, and the account is made straight away.
 */
export default function Register() {
  const { user, register } = useAuth();
  const { t } = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  // Only while the server's SMS is in test mode (no SMS can reach the phone): the code, shown on screen.
  const [testCode, setTestCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Redirect href="/" />;

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ code_needed: boolean; message?: string; test_code?: string }>('/auth/register/code', {
        method: 'POST',
        body: { phone: phone.trim() },
      });
      if (!res.code_needed) {
        await register(name.trim(), phone.trim(), password);
        return;
      }
      setSent(res.message ?? null);
      setTestCode(res.test_code ?? null);
      setCode(res.test_code ?? '');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), phone.trim(), password, code.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setSent(null);
    setTestCode(null);
    setCode('');
    setError(null);
  };

  return (
    <AuthForm subtitle={t('Create your passenger account')}>
      {error && <ErrorBox message={error} />}
      {!sent ? (
        <>
          <Field label={t('Full name')} autoComplete="name" value={name} onChangeText={setName} />
          <Field
            label={t('M-Pesa phone number')}
            placeholder="07XX XXX XXX"
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phone}
            onChangeText={setPhone}
          />
          <Field label={t('Password')} hint={t('At least 6 characters')} secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
          <Button
            title={t('Send me a code')}
            icon="chatbubble-ellipses-outline"
            onPress={sendCode}
            loading={busy}
            disabled={name.trim().length < 2 || phone.trim().length < 9 || password.length < 6}
          />
          <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 13 }}>
            {t('By creating an account you agree to our')}{' '}
            <Text style={{ color: colors.primary, fontWeight: '600' }} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
              {t('privacy policy')}
            </Text>
            .
          </Text>
        </>
      ) : (
        <>
          <Notice tone="success">{t('We sent a 6-digit code by SMS to {phone}. It works for 10 minutes.', { phone: phone.trim() })}</Notice>
          {testCode && <Notice>{t('SMS test mode: no SMS is sent, so your code is {code}. It is filled in below.', { code: testCode })}</Notice>}
          <Field
            label={t('Code from the SMS')}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            maxLength={6}
            value={code}
            onChangeText={(typed) => setCode(typed.replace(/\D/g, ''))}
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
          />
          <Button title={t('Create account')} onPress={create} loading={busy} disabled={code.length !== 6} />
          <Button title={t('Send a new code')} variant="secondary" onPress={sendCode} disabled={busy} />
          <Button title={t('Change number')} variant="secondary" onPress={changeNumber} disabled={busy} />
        </>
      )}
      <Link href="/sign-in" style={{ textAlign: 'center', marginTop: 12, padding: 8 }}>
        <Text style={{ color: colors.muted }}>
          {t('Already have an account?')} <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('Sign in')}</Text>
        </Text>
      </Link>
    </AuthForm>
  );
}
