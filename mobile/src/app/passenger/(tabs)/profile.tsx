import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useConfirmSignOut } from '@/components/AccountScreen';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Button, Card, colors, List, ListRow, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { HELP_URL, PRIVACY_POLICY_URL, WEBSITE_URL } from '@/lib/links';

/** Profile: who you are (tap for name, password), FarePay extras, language, help links, sign out. */
export default function Profile() {
  const { user } = useAuth();
  const { t } = useT();
  const confirmSignOut = useConfirmSignOut();
  if (!user) return null;

  return (
    <Screen>
      <Pressable onPress={() => router.push('/passenger/account')} style={({ pressed }) => [styles.me, pressed && { opacity: 0.8 }]} accessibilityRole="button">
        <View style={styles.avatar}>
          <Text style={styles.initial}>{user.name.trim().charAt(0).toUpperCase() || '?'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.phone}>{displayPhone(user.phone)}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>

      <SectionTitle>{t('My FarePay')}</SectionTitle>
      <List>
        <ListRow icon="star-outline" title={t('Saved drop-offs')} subtitle={t('Tap the star next to a drop-off to save it')} onPress={() => router.push('/passenger/choose-route')} />
        <ListRow icon="pricetags-outline" title={t('Fare changes')} subtitle={t('Recent and coming fare changes')} onPress={() => router.push('/passenger/fare-changes')} />
        <ListRow icon="chatbox-ellipses-outline" title={t('Report a problem')} subtitle={t('Payment issue, wrong fare, charged twice…')} onPress={() => router.push('/passenger/report')} />
        <ListRow icon="document-text-outline" title={t('My reports')} subtitle={t('See replies from the SACCO office')} onPress={() => router.push('/passenger/reports')} />
      </List>

      <SectionTitle>{t('Preferences')}</SectionTitle>
      <Card style={styles.prefs}>
        <Text style={styles.prefLabel}>{t('Language')}</Text>
        <LanguageSwitch style={{ marginTop: 0 }} />
      </Card>

      <SectionTitle>{t('Support')}</SectionTitle>
      <List>
        <ListRow title={t('Help and support')} external onPress={() => void Linking.openURL(HELP_URL)} />
        <ListRow title={t('Privacy policy')} external onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />
        <ListRow title={t('About FarePay')} external onPress={() => void Linking.openURL(WEBSITE_URL)} />
      </List>

      <View style={{ marginTop: 12 }}>
        <Button title={t('Sign out')} variant="danger" onPress={confirmSignOut} />
      </View>
      <Pressable onPress={() => router.push('/passenger/delete-account')} style={styles.delete} accessibilityRole="button">
        <Text style={styles.deleteText}>{t('Delete account')}</Text>
      </Pressable>
      <Text style={styles.version}>FarePay · v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  me: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontSize: 24, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  phone: { fontSize: 14, color: colors.muted, marginTop: 2 },
  prefs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  prefLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  delete: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  deleteText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  version: { textAlign: 'center', fontSize: 12, color: colors.muted, marginTop: 8 },
});
