import { router } from 'expo-router';
import { AccountScreen } from '@/components/AccountScreen';
import { List, ListRow } from '@/components/ui';

export default function Account() {
  return (
    <AccountScreen>
      <List>
        <ListRow icon="chatbox-ellipses-outline" title="Report a problem" subtitle="Payments, the vehicle, or anything else" onPress={() => router.push('/driver/report')} />
        <ListRow icon="document-text-outline" title="My reports" subtitle="See replies from the SACCO office" onPress={() => router.push('/driver/reports')} />
      </List>
    </AccountScreen>
  );
}
