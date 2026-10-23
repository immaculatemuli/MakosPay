import { Redirect, Stack } from 'expo-router';
import { stackOptions } from '@/components/navigation';
import { useAuth } from '@/lib/auth';
import { isOffice } from '@/lib/types';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AdminLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/sign-in" />;
  if (!isOffice(user.role)) return <Redirect href="/" />;
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="route-form" options={{ title: 'Route' }} />
      <Stack.Screen name="vehicle/[id]" options={{ title: 'Vehicle' }} />
      <Stack.Screen name="vehicle-form" options={{ title: 'Vehicle details' }} />
      <Stack.Screen name="crew" options={{ title: 'Crew' }} />
      <Stack.Screen name="crew-form" options={{ title: 'New crew member' }} />
      <Stack.Screen name="payout/[id]" options={{ title: 'Payout' }} />
      <Stack.Screen name="passengers" options={{ title: 'Passengers' }} />
      <Stack.Screen name="search" options={{ title: 'Search' }} />
      <Stack.Screen name="owners" options={{ title: 'Vehicle owners' }} />
      <Stack.Screen name="broadcast" options={{ title: 'Message crew' }} />
      <Stack.Screen name="exports" options={{ title: 'Reports & downloads' }} />
      <Stack.Screen name="owner/[id]" options={{ title: 'Owner' }} />
      <Stack.Screen name="owner-form" options={{ title: 'Owner' }} />
      <Stack.Screen name="set-password" options={{ title: 'Set new password' }} />
      <Stack.Screen name="refund" options={{ title: 'Refund fare' }} />
      <Stack.Screen name="refund-requests" options={{ title: 'Refunds asked by crew' }} />
      <Stack.Screen name="staff" options={{ title: 'Office staff' }} />
      <Stack.Screen name="staff-form" options={{ title: 'New office account' }} />
      <Stack.Screen name="platform" options={{ title: 'Platform' }} />
      <Stack.Screen name="reports" options={{ title: 'Problem reports' }} />
      <Stack.Screen name="fare-history" options={{ title: 'Fare history' }} />
      <Stack.Screen name="audit" options={{ title: 'Audit log' }} />
      <Stack.Screen name="reconciliation" options={{ title: 'Money check' }} />
      <Stack.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Stack.Screen name="withdrawals" options={{ title: 'Passenger withdrawals' }} />
      <Stack.Screen name="statement" options={{ title: 'M-Pesa statement check' }} />
      <Stack.Screen name="account" options={{ title: 'My account' }} />
      <Stack.Screen name="trips" options={{ title: 'Bookings & trips' }} />
      <Stack.Screen name="trip/[id]" options={{ title: 'Trip' }} />
      <Stack.Screen name="parcels" options={{ title: 'Parcels' }} />
      <Stack.Screen name="parcel-form" options={{ title: 'Record a parcel' }} />
      <Stack.Screen name="parcel/[id]" options={{ title: 'Parcel' }} />
    </Stack>
  );
}
