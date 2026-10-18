import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, ErrorBox } from '@/components/ui';
import { officeHref } from '@/lib/officeLinks';
import { useApi } from '@/lib/useApi';

export interface AttentionItem {
  key: string;
  severity: 'high' | 'medium' | 'low';
  count: number;
  title: string;
  detail: string;
  link: string | null;
}

const TONE = {
  high: { bar: colors.danger, soft: colors.dangerSoft, icon: 'alert-circle' as const },
  medium: { bar: colors.warning, soft: colors.warningSoft, icon: 'warning' as const },
  low: { bar: colors.muted, soft: '#F3F4F6', icon: 'information-circle' as const },
};

/** The office's to-do list: everything that needs someone now, most urgent first. Empty = nothing to do. */
export function NeedsAttention() {
  const list = useApi<{ items: AttentionItem[] }>('/admin/attention');
  if (list.error) return <ErrorBox message={list.error} onRetry={list.reload} />;
  const items = list.data?.items;
  if (!items) return null;
  if (items.length === 0) {
    return (
      <View style={[styles.item, { backgroundColor: colors.primarySoft, borderLeftColor: colors.primary }]}>
        <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
        <Text style={[styles.title, { color: colors.primaryDark }]}>Nothing needs attention right now</Text>
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.heading}>Needs attention ({items.length})</Text>
      {items.map((i) => {
        const tone = TONE[i.severity];
        const href = officeHref(i.link);
        return (
          <Pressable
            key={i.key}
            disabled={!href}
            onPress={href ? () => router.push(href) : undefined}
            style={({ pressed }) => [styles.item, { backgroundColor: tone.soft, borderLeftColor: tone.bar }, pressed && { opacity: 0.7 }]}
            accessibilityRole={href ? 'button' : undefined}
          >
            <Ionicons name={tone.icon} size={24} color={tone.bar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {i.title}
                {i.count > 1 && !/^\d/.test(i.title) ? ` (${i.count})` : ''}
              </Text>
              {!!i.detail && <Text style={styles.detail}>{i.detail}</Text>}
            </View>
            {href && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 14, marginBottom: 8, borderLeftWidth: 5 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  detail: { fontSize: 13, color: colors.text, marginTop: 2 },
});
