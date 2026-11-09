import Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { HeaderActions } from '../AccountButton';
import { tabOptions } from '../navigation';
import { useT } from '@/lib/i18n';

/** Bottom tabs for conductors and drivers: Payments, seat Bookings, Parcels and Check ticket, with My account at the top right. */
export function CrewTabs({ accountHref }: { accountHref: Href }) {
  const { t } = useT();
  return (
    <Tabs screenOptions={{ ...tabOptions, headerRight: () => <HeaderActions accountHref={accountHref} /> }}>
      <Tabs.Screen
        name="index"
        options={{ title: t('Payments'), tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="bookings"
        options={{ title: t('Bookings'), tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="parcels"
        options={{ title: t('Parcels'), tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="check"
        options={{ title: t('Check ticket'), tabBarIcon: ({ color, size }) => <Ionicons name="ticket-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
