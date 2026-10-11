import { router } from 'expo-router';
import { AccountScreen } from '@/components/AccountScreen';
import { List, ListRow } from '@/components/ui';

/** Profile: saved drop-offs, problem reports, then the shared account settings (password, privacy, sign out, delete). */
export default function Profile() {
  return (
    <AccountScreen>
      <List>
        <ListRow icon="star-outline" title="Saved drop-offs" subtitle="Tap the star next to a drop-off to save it" onPress={() => router.push('/passenger/choose-route')} />
        <ListRow icon="pricetags-outline" title="Fare changes" subtitle="Recent and coming fare changes" onPress={() => router.push('/passenger/fare-changes')} />
        <ListRow icon="chatbox-ellipses-outline" title="Report a problem" subtitle="Payment issue, wrong fare, charged twice…" onPress={() => router.push('/passenger/report')} />
        <ListRow icon="document-text-outline" title="My reports" subtitle="See replies from the SACCO office" onPress={() => router.push('/passenger/reports')} />
      </List>
    </AccountScreen>
  );
}
