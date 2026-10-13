import Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { HeaderActions } from '../AccountButton';
import { tabOptions } from '../navigation';

/** Bottom tabs for conductors and drivers: Payments, seat Bookings and Check ticket, with My account at the top right. */
export function CrewTabs({ accountHref }: { accountHref: Href }) {
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <HeaderActions accountHref={accountHref} /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Payments', tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="bookings"
        options={{ title: 'Bookings', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="check"
        options={{ title: 'Check ticket', tabBarIcon: ({ color, size }) => <Ionicons name="ticket-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
