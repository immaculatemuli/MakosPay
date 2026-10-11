import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';

export const unstable_settings = { initialRouteName: '(tabs)' };

/** Drivers: their vehicle's payments and ticket checks (no route changes, no money actions). */
export default function DriverLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'driver') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="report" options={{ title: 'Report a problem' }} />
      <Stack.Screen name="reports" options={{ title: 'My reports' }} />
      <Stack.Screen name="account" options={{ title: 'My account' }} />
    </Stack>
  );
}
