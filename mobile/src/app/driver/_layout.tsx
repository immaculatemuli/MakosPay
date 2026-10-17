import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export const unstable_settings = { initialRouteName: '(tabs)' };

/** Drivers: their vehicle's payments and ticket checks (no route changes, no money actions). */
export default function DriverLayout() {
  const { user } = useAuth();
  const { t } = useT();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'driver') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: t('Notifications') }} />
      <Stack.Screen name="report" options={{ title: t('Report a problem') }} />
      <Stack.Screen name="reports" options={{ title: t('My reports') }} />
      <Stack.Screen name="account" options={{ title: t('My account') }} />
    </Stack>
  );
}
