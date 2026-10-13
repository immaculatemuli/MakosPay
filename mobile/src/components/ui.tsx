import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

export const colors = {
  // Makos Sacco magenta (white text on it is easy to read).
  primary: '#D4268F',
  primaryDark: '#A8166E',
  primarySoft: '#FCE7F3',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  bg: '#F5F6F8',
  card: '#FFFFFF',
  danger: '#B91C1C',
  dangerSoft: '#FDECEC',
  warning: '#92400E',
  warningSoft: '#FEF3C7',
};

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Scrollable page with standard padding and optional pull-to-refresh. */
export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Muted({ children, center }: { children: ReactNode; center?: boolean }) {
  return <Text style={[styles.muted, center && { textAlign: 'center' }]}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const inactive = disabled || loading;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1 },
        variant === 'danger' && { backgroundColor: colors.card, borderColor: colors.danger, borderWidth: 1 },
        pressed && { opacity: 0.8 },
        inactive && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={20} color={fg} />}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#9CA3AF" style={[styles.input, style]} {...props} />
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Notice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'success' }) {
  const ok = tone === 'success';
  return (
    <View style={[styles.notice, { backgroundColor: ok ? colors.primarySoft : colors.warningSoft }]}>
      <Text style={{ color: ok ? colors.primaryDark : colors.warning, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ paddingVertical: 32 }}>
      <Muted center>{text}</Muted>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  rightSub,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: string;
  rightSub?: ReactNode;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && { backgroundColor: '#F3F4F6' }]}
    >
      {icon && <Ionicons name={icon} size={22} color={colors.primary} style={{ marginRight: 12 }} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.rowSub}>{subtitle}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
        {right !== undefined && <Text style={styles.rowRight}>{right}</Text>}
        {rightSub}
      </View>
      {onPress && <Ionicons name="chevron-forward" size={18} color="#9CA3AF" style={{ marginLeft: 4 }} />}
    </Pressable>
  );
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'success' | 'danger' | 'warning' }) {
  const palette = {
    neutral: ['#F3F4F6', colors.muted],
    success: [colors.primarySoft, colors.primaryDark],
    danger: [colors.dangerSoft, colors.danger],
    warning: [colors.warningSoft, colors.warning],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette[0] }]}>
      <Text style={{ color: palette[1], fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** Single-choice selector shown as wrapping chips. */
export function Chips<T extends string | number | null>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <View style={styles.field}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.chips}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              style={[styles.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={{ color: selected ? '#fff' : colors.text, fontWeight: '500' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.muted}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={styles.kvValue}>{value}</Text> : value}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: 12, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 14 },
  button: {
    minHeight: 50,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: 10, padding: 12, marginBottom: 12 },
  errorText: { color: colors.danger, fontSize: 14 },
  retry: { color: colors.danger, fontWeight: '700', marginTop: 8 },
  notice: { borderRadius: 10, padding: 12, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowRight: { fontSize: 15, fontWeight: '600', color: colors.text },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 },
  kvValue: { fontSize: 15, color: colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  list: { borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginBottom: 12 },
});

/** Groups ListRows into a rounded block. */
export function List({ children }: { children: ReactNode }) {
  return <View style={styles.list}>{children}</View>;
}
