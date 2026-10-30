import { router } from 'expo-router';
import { AccountScreen } from '@/components/AccountScreen';
import { List, ListRow } from '@/components/ui';
import { useT } from '@/lib/i18n';

export default function Account() {
  const { t } = useT();
  return (
    <AccountScreen>
      <List>
        <ListRow icon="chatbox-ellipses-outline" title={t('Report a problem')} subtitle={t('Payments, the vehicle, or anything else')} onPress={() => router.push('/conductor/report')} />
        <ListRow icon="document-text-outline" title={t('My reports')} subtitle={t('See replies from the SACCO office')} onPress={() => router.push('/conductor/reports')} />
      </List>
    </AccountScreen>
  );
}
