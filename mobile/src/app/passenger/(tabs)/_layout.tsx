import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { AccountButton } from '@/components/AccountButton';
import { tabOptions } from '@/components/navigation';

export default function PassengerTabs() {
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <AccountButton href="/passenger/account" /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'FarePay', tabBarLabel: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: 'My payments', tabBarLabel: 'Payments', tabBarIcon: ({ color, size }) => <Ionicons name="receipt-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
