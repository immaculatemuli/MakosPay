import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { HeaderActions } from '@/components/AccountButton';
import { tabOptions } from '@/components/navigation';

/** Passenger tabs, as in the brief: Home, Pay, Wallet, Trips, Profile. */
export default function PassengerTabs() {
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <HeaderActions /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'FarePay', tabBarLabel: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="pay"
        options={{ title: 'Pay fare', tabBarLabel: 'Pay', tabBarIcon: ({ color, size }) => <Ionicons name="qr-code-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: 'My trips', tabBarLabel: 'Trips', tabBarIcon: ({ color, size }) => <Ionicons name="bus-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
