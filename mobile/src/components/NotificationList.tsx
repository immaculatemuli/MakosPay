import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, type ComponentProps } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { setUnread, targetHref } from '@/lib/notifications';
import type { AppNotification } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';
import { colors, Empty, ErrorBox, Loading } from './ui';

type IconName = ComponentProps<typeof Ionicons>['name'];

function iconFor(kind: string): IconName {
  if (kind.startsWith('topup') || kind.startsWith('fare_mpesa')) return 'wallet-outline';
  if (kind.startsWith('withdrawal')) return 'arrow-up-circle-outline';
  if (kind === 'fare.refunded') return 'return-down-back-outline';
  if (kind === 'fare.changed') return 'pricetag-outline';
  if (kind.startsWith('report')) return 'chatbox-ellipses-outline';
  if (kind.startsWith('payout')) return 'send-outline';
  if (kind.startsWith('money_check')) return 'alert-circle-outline';
  return 'notifications-outline';
}

/** Everyone's notifications, newest first. Opening the list marks them read; new ones keep a dot until then. */
export function NotificationList() {
  const { user } = useAuth();
  const list = usePaged<AppNotification>('/notifications');
  const marked = useRef<number | null>(null);

  // Mark everything read once the newest unread one is on screen (only once per newest notification).
  const newestUnread = list.items.find((n) => !n.read_at)?.id ?? null;
  useEffect(() => {
    if (newestUnread === null || marked.current === newestUnread) return;
    marked.current = newestUnread;
    api<{ unread: number }>('/notifications/read', { method: 'POST', body: {} })
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, [newestUnread]);

  if (list.loading && list.items.length === 0) return <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={list.items}
      keyExtractor={(n) => String(n.id)}
      refreshing={list.refreshing}
      onRefresh={list.refresh}
      onEndReached={list.loadMore}
      ListHeaderComponent={list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}
      ListEmptyComponent={<Empty text="No notifications yet. Top-ups, refunds, fare changes and replies will show here." />}
      renderItem={({ item }) => {
        const href = user ? targetHref(user.role, item.target) : null;
        return (
          <Pressable
            onPress={href ? () => router.push(href) : undefined}
            disabled={!href}
            style={({ pressed }) => [styles.item, !item.read_at && styles.unread, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.icon}>
              <Ionicons name={iconFor(item.kind)} size={20} color={item.kind.endsWith('failed') ? colors.danger : colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              {item.body && <Text style={styles.body}>{item.body}</Text>}
              <Text style={styles.time}>{dateTime(item.created_at)}</Text>
            </View>
            {!item.read_at && <View style={styles.dot} accessibilityLabel="Unread" />}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  unread: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.text, marginTop: 2 },
  time: { fontSize: 12, color: colors.muted, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 },
});
