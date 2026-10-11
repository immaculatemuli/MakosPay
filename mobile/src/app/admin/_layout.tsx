import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AdminLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'admin') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="route-form" options={{ title: 'Route' }} />
      <Stack.Screen name="vehicle/[id]" options={{ title: 'Vehicle' }} />
      <Stack.Screen name="vehicle-form" options={{ title: 'Vehicle details' }} />
      <Stack.Screen name="conductors" options={{ title: 'Conductors' }} />
      <Stack.Screen name="conductor-form" options={{ title: 'New conductor' }} />
      <Stack.Screen name="payout/[id]" options={{ title: 'Payout' }} />
      <Stack.Screen name="passengers" options={{ title: 'Passengers' }} />
      <Stack.Screen name="set-password" options={{ title: 'Set new password' }} />
      <Stack.Screen name="refund" options={{ title: 'Refund fare' }} />
      <Stack.Screen name="staff" options={{ title: 'Office staff' }} />
      <Stack.Screen name="staff-form" options={{ title: 'New office account' }} />
      <Stack.Screen name="account" options={{ title: 'My account' }} />
    </Stack>
  );
}
