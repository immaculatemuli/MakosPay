import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function PassengerLayout() {
  const { user } = useAuth();
  const { t } = useT();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'passenger') return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: t('Notifications') }} />
      <Stack.Screen name="choose-route" options={{ title: t('Choose your route') }} />
      <Stack.Screen name="scan" options={{ title: t('Scan the QR code') }} />
      <Stack.Screen name="pay" options={{ title: t('Confirm payment') }} />
      <Stack.Screen name="ticket" options={{ title: t('Your ticket'), headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="topup" options={{ title: t('Add money with M-Pesa') }} />
      <Stack.Screen name="withdraw" options={{ title: t('Withdraw to M-Pesa') }} />
      <Stack.Screen name="report" options={{ title: t('Report a problem') }} />
      <Stack.Screen name="reports" options={{ title: t('My reports') }} />
      <Stack.Screen name="fare-changes" options={{ title: t('Fare changes') }} />
      <Stack.Screen name="book" options={{ title: t('Book a seat') }} />
      <Stack.Screen name="booking" options={{ title: t('Your booking') }} />
      <Stack.Screen name="parcel" options={{ title: t('Track a parcel') }} />
      <Stack.Screen name="account" options={{ title: t('My account') }} />
      <Stack.Screen name="delete-account" options={{ title: t('Delete account') }} />
    </Stack>
  );
}
