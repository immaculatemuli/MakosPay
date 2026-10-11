import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { AccountButton } from '@/components/AccountButton';
import { tabOptions } from '@/components/navigation';

export default function ConductorTabs() {
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <AccountButton href="/conductor/account" /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Payments', tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="check"
        options={{ title: 'Check ticket', tabBarIcon: ({ color, size }) => <Ionicons name="ticket-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
