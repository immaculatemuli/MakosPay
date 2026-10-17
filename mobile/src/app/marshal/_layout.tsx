import { Redirect, Stack } from 'expo-router';
import { HeaderActions } from '@/components/AccountButton';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { isOffice } from '@/lib/types';

/** Stage marshals (the office can open the same screens): the queues of booked passengers and the cars. */
export default function MarshalLayout() {
  const { user } = useAuth();
  const { t } = useT();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'marshal' && !isOffice(user.role)) return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen
        name="index"
        options={{ title: t('Stage queue'), headerRight: () => (user.role === 'marshal' ? <HeaderActions accountHref="/marshal/account" /> : null) }}
      />
      <Stack.Screen name="arrived" options={{ title: t('A car has arrived') }} />
      <Stack.Screen name="notifications" options={{ title: t('Notifications') }} />
      <Stack.Screen name="account" options={{ title: t('My account') }} />
    </Stack>
  );
}
