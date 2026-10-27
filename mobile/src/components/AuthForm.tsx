import { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LanguageSwitch } from './LanguageSwitch';
import { colors } from './ui';

/** Full-screen layout for sign-in and registration (no navigation header). footer: shown under the language switch. */
export function AuthForm({ subtitle, children, footer }: { subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <Text style={{ fontSize: 34, fontWeight: '800', color: colors.primary }}>FarePay</Text>
            <Text style={{ color: colors.muted, marginTop: 6, fontSize: 15 }}>{subtitle}</Text>
          </View>
          {children}
          <LanguageSwitch />
          {footer}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
