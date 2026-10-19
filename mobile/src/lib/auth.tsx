import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, configureAuth, loadApiUrl } from './api';
import { registerForPush, unregisterPush } from './push';
import { forgetSavedTickets, setTicketOwner } from './savedTickets';
import type { User } from './types';

// Older versions kept the sign-in on the phone; it is deleted at start-up. Now a sign-in lasts only while
// the app is open: every time the app starts, it asks for the phone number and password.
const OLD_SESSION_KEY = 'farepay.session';
// The last phone number signed in with (not the password), to fill in the sign-in form.
const LAST_PHONE_KEY = 'farepay.lastPhone';

export const lastPhoneNumber = () => SecureStore.getItemAsync(LAST_PHONE_KEY).catch(() => null);

interface Session {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (phone: string, password: string) => Promise<void>;
  /** code: the 6-digit sign-up code from the SMS (left out when the server sends none). */
  register: (name: string, phone: string, password: string, code?: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Passengers: corrects their name. */
  rename: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Kept in memory only, never saved on the phone. Signed in: this phone is registered for push notifications.
  const save = useCallback(async (next: Session | null) => {
    configureAuth(next?.token ?? null);
    setTicketOwner(next?.user.role === 'passenger' ? next.user.phone : null);
    setSession(next);
    if (next) {
      await SecureStore.setItemAsync(LAST_PHONE_KEY, next.user.phone).catch(() => {});
      void registerForPush();
    }
  }, []);

  // While still signed in, stop this phone getting the person's push notifications; then forget the sign-in.
  const signOut = useCallback(async () => {
    await unregisterPush();
    forgetSavedTickets();
    await save(null);
  }, [save]);

  useEffect(() => {
    configureAuth(null, () => void signOut());
    (async () => {
      try {
        await loadApiUrl(); // the server address saved on this phone, if any
        await SecureStore.deleteItemAsync(OLD_SESSION_KEY).catch(() => {});
      } finally {
        setLoading(false);
      }
    })();
  }, [signOut]);

  const signIn = useCallback(
    async (phone: string, password: string) => {
      const res = await api<Session>('/auth/login', { method: 'POST', body: { phone, password } });
      await save(res);
    },
    [save],
  );

  const register = useCallback(
    async (name: string, phone: string, password: string, code?: string) => {
      const res = await api<Session>('/auth/register', { method: 'POST', body: { name, phone, password, code } });
      await save(res);
    },
    [save],
  );

  // A new password signs out every other phone; this one gets a fresh sign-in so it stays signed in.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const res = await api<Session>('/auth/change-password', { method: 'POST', body: { current_password: currentPassword, new_password: newPassword } });
      await save(res);
    },
    [save],
  );

  const rename = useCallback(async (name: string) => {
    const res = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { name } });
    setSession((current) => (current ? { ...current, user: res.user } : current));
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, loading, signIn, register, changePassword, rename, signOut }),
    [session, loading, signIn, register, changePassword, rename, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
