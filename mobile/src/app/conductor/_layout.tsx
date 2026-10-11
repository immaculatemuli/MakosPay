import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function ConductorLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'conductor') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="change-route" options={{ title: 'Change route' }} />
      <Stack.Screen name="account" options={{ title: 'My account' }} />
    </Stack>
  );
}
