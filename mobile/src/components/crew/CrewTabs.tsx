import Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { AccountButton } from '../AccountButton';
import { tabOptions } from '../navigation';

/** Bottom tabs for conductors and drivers: Payments and Check ticket, with My account at the top right. */
export function CrewTabs({ accountHref }: { accountHref: Href }) {
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <AccountButton href={accountHref} /> }}>
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
