import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function ConductorLayout() {
  const { user } = useAuth();
  const { t } = useT();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'conductor') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: t('Notifications') }} />
      <Stack.Screen name="change-route" options={{ title: t('Change route') }} />
      <Stack.Screen name="report" options={{ title: t('Report a problem') }} />
      <Stack.Screen name="reports" options={{ title: t('My reports') }} />
      <Stack.Screen name="scan-car" options={{ title: t('Scan the car') }} />
      <Stack.Screen name="board" options={{ title: t('Scan passengers on board') }} />
      <Stack.Screen name="refund" options={{ title: t('Paid by mistake?') }} />
      <Stack.Screen name="account" options={{ title: t('My account') }} />
    </Stack>
  );
}
