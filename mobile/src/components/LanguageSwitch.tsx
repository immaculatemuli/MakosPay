import { Pressable, Text, View } from 'react-native';
import { type Language, useT } from '@/lib/i18n';
import { colors } from './ui';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'sw', label: 'Kiswahili' },
];

/** English | Kiswahili, on the sign-in screens and in My account. Each name is written in its own language. */
export function LanguageSwitch() {
  const { language, setLanguage } = useT();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 }} accessibilityRole="radiogroup">
      {LANGUAGES.map((l) => {
        const on = l.value === language;
        return (
          <Pressable
            key={l.value}
            onPress={() => setLanguage(l.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={{
              paddingVertical: 7,
              paddingHorizontal: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? colors.primary : colors.border,
              backgroundColor: on ? colors.primary : colors.card,
            }}
          >
            <Text style={{ color: on ? '#fff' : colors.text, fontWeight: on ? '700' : '500' }}>{l.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
