import { router } from 'expo-router';
import { AccountScreen } from '@/components/AccountScreen';
import { List, ListRow } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** Profile: saved drop-offs, problem reports, then the shared account settings (password, privacy, sign out, delete). */
export default function Profile() {
  const { t } = useT();
  return (
    <AccountScreen>
      <List>
        <ListRow icon="star-outline" title={t('Saved drop-offs')} subtitle={t('Tap the star next to a drop-off to save it')} onPress={() => router.push('/passenger/choose-route')} />
        <ListRow icon="pricetags-outline" title={t('Fare changes')} subtitle={t('Recent and coming fare changes')} onPress={() => router.push('/passenger/fare-changes')} />
        <ListRow icon="chatbox-ellipses-outline" title={t('Report a problem')} subtitle={t('Payment issue, wrong fare, charged twice…')} onPress={() => router.push('/passenger/report')} />
        <ListRow icon="document-text-outline" title={t('My reports')} subtitle={t('See replies from the SACCO office')} onPress={() => router.push('/passenger/reports')} />
      </List>
    </AccountScreen>
  );
}
