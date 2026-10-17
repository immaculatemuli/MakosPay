import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useUnread } from '@/lib/notifications';
import { ROLE_HOME } from '@/lib/types';
import { colors } from './ui';

/** Person icon at the top right of a tab: opens My account (password, sign out). */
export function AccountButton({ href }: { href: Href }) {
  const { t } = useT();
  return (
    <Pressable onPress={() => router.push(href)} hitSlop={10} style={{ marginRight: 16 }} accessibilityLabel={t('My account')}>
      <Ionicons name="person-circle-outline" size={28} color={colors.primary} />
    </Pressable>
  );
}

/** Bell at the top right, with the number of unread notifications. */
export function NotificationBell() {
  const { user } = useAuth();
  const unread = useUnread();
  const { t } = useT();
  if (!user) return null;
  return (
    <Pressable
      onPress={() => router.push(`${ROLE_HOME[user.role]}/notifications`)}
      hitSlop={10}
      style={{ marginRight: 16 }}
      accessibilityLabel={unread ? t('Notifications, {n} unread', { n: unread }) : t('Notifications')}
    >
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={26} color={colors.primary} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Top-right header buttons: the bell, and My account when the section has no Profile tab. */
export function HeaderActions({ accountHref }: { accountHref?: Href }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <NotificationBell />
      {accountHref && <AccountButton href={accountHref} />}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
