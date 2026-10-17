import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SW } from './sw';

// The app in English or Kiswahili (passengers, crew, signing in; the office screens are English only).
// Texts are written in English in the code and looked up in SW; anything not translated yet shows in English.
// {name} in a text is filled in from `vars`. The choice is kept on the phone.
export type Language = 'en' | 'sw';
const KEY = 'farepay.language';

let current: Language = 'en';

/** The text in the chosen language (also usable outside screens, e.g. in an alert from a helper). */
export function t(text: string, vars?: Record<string, string | number>) {
  const chosen = current === 'sw' ? (SW[text] ?? text) : text;
  return vars ? chosen.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole)) : chosen;
}

export const currentLanguage = () => current;

const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({
  language: 'en',
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(current);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((saved) => {
        if (saved === 'sw' || saved === 'en') {
          current = saved;
          setState(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((next: Language) => {
    current = next;
    setState(next);
    SecureStore.setItemAsync(KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** In a screen: `t` for its texts; the screen shows again in the new language when it is changed. */
export function useT() {
  const { language, setLanguage } = useContext(LanguageContext);
  // `language` is read so the returned function changes (and screens using it update) with the language.
  const tr = useCallback((text: string, vars?: Record<string, string | number>) => (language ? t(text, vars) : text), [language]);
  return { t: tr, language, setLanguage };
}
