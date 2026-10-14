import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { isOffice } from '@/lib/types';

function RootNavigator() {
  const { loading, user } = useAuth();

  // Tapping a push notification opens the bell (the notifications list) of whoever is signed in.
  const section = user ? (isOffice(user.role) ? 'admin' : user.role) : null;
  useEffect(() => {
    if (!section) return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push(`/${section}/notifications` as never);
    });
    return () => sub.remove();
  }, [section]);

  if (loading) return <Loading />;
  // Each role's section (passenger/, conductor/, admin/) checks the signed-in role in its own layout.
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
