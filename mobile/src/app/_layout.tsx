import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';

function RootNavigator() {
  const { loading } = useAuth();
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
