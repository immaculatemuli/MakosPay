import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function PassengerLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'passenger') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="choose-route" options={{ title: 'Choose your route' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan the QR code' }} />
      <Stack.Screen name="pay" options={{ title: 'Confirm payment' }} />
      <Stack.Screen name="ticket" options={{ title: 'Your ticket', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="topup" options={{ title: 'Add money with M-Pesa' }} />
      <Stack.Screen name="report" options={{ title: 'Report a problem' }} />
      <Stack.Screen name="reports" options={{ title: 'My reports' }} />
      <Stack.Screen name="fare-changes" options={{ title: 'Fare changes' }} />
    </Stack>
  );
}
