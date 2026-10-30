import { NameForm, PasswordForm } from '@/components/AccountScreen';
import { Card, KeyValue, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import { useT } from '@/lib/i18n';

/** Opened from the name at the top of Profile: the passenger's details, name change and password change. */
export default function PassengerAccount() {
  const { user } = useAuth();
  const { t } = useT();
  if (!user) return null;
  return (
    <Screen>
      <Card>
        <KeyValue label={t('Name')} value={user.name} />
        <KeyValue label={t('Phone')} value={displayPhone(user.phone)} />
      </Card>
      <NameForm />
      <PasswordForm />
    </Screen>
  );
}
