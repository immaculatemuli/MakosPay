import { Link, Redirect } from 'expo-router';
import { Linking, Text } from 'react-native';
import { AuthForm } from '@/components/AuthForm';
import { Button, colors, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { HELP_URL } from '@/lib/links';

/** Forgot password: the SACCO office sets a new one. */
export default function ForgotPassword() {
  const { user } = useAuth();
  const { t } = useT();
  if (user) return <Redirect href="/" />;

  return (
    <AuthForm subtitle={t('Forgot password?')}>
      <Notice>{t('Ask the SACCO office to set a new password for you, then sign in with it.')}</Notice>
      <Button title={t('Contact the SACCO office')} icon="call-outline" onPress={() => void Linking.openURL(HELP_URL)} />
      <Link href="/sign-in" style={{ textAlign: 'center', marginTop: 12, padding: 8 }}>
        <Text style={{ color: colors.muted }}>
          {t('Remembered it?')} <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('Sign in')}</Text>
        </Text>
      </Link>
    </AuthForm>
  );
}
