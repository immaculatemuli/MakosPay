import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { HeaderActions } from '@/components/AccountButton';
import { tabOptions } from '@/components/navigation';

export default function AdminTabs() {
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <HeaderActions accountHref="/admin/account" /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="payments"
        options={{ title: 'Payments', tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="payouts"
        options={{ title: 'Payouts', tabBarIcon: ({ color, size }) => <Ionicons name="send-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="routes"
        options={{ title: 'Routes', tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{ title: 'Vehicles', tabBarIcon: ({ color, size }) => <Ionicons name="bus-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
