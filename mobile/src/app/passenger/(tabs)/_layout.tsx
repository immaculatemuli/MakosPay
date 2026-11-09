import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { HeaderActions } from '@/components/AccountButton';
import { tabOptions } from '@/components/navigation';
import { useT } from '@/lib/i18n';

/** Passenger tabs, as in the brief: Home, Pay, Wallet, Trips (and seat bookings), Profile. */
export default function PassengerTabs() {
  const { t } = useT();
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <HeaderActions /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'FarePay', tabBarLabel: t('Home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="pay"
        options={{ title: t('Pay fare'), tabBarLabel: t('Pay'), tabBarIcon: ({ color, size }) => <Ionicons name="qr-code-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: t('Wallet'), tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: t('Trips & bookings'), tabBarLabel: t('Trips'), tabBarIcon: ({ color, size }) => <Ionicons name="bus-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t('Profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
