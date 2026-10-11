import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, configureAuth, loadApiUrl } from './api';
import type { User } from './types';

const SESSION_KEY = 'farepay.session';

interface Session {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  resetPassword: (phone: string, code: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const save = useCallback(async (next: Session | null) => {
    configureAuth(next?.token ?? null);
    setSession(next);
    if (next) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  }, []);

  const signOut = useCallback(() => save(null), [save]);

  useEffect(() => {
    configureAuth(null, () => void signOut());
    (async () => {
      try {
        await loadApiUrl(); // the server address saved on this phone, if any
        const stored = await SecureStore.getItemAsync(SESSION_KEY);
        if (!stored) return;
        const cached: Session = JSON.parse(stored);
        configureAuth(cached.token);
        setSession(cached); // open immediately with the cached user, then refresh it
        try {
          const { user } = await api<{ user: User }>('/auth/me');
          await save({ token: cached.token, user });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) await save(null);
          // Network errors: keep the cached session; screens will show their own errors.
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [save, signOut]);

  const signIn = useCallback(
    async (phone: string, password: string) => {
      const res = await api<Session>('/auth/login', { method: 'POST', body: { phone, password } });
      await save(res);
    },
    [save],
  );

  const register = useCallback(
    async (name: string, phone: string, password: string) => {
      const res = await api<Session>('/auth/register', { method: 'POST', body: { name, phone, password } });
      await save(res);
    },
    [save],
  );

  // Forgot password: the SMS code sets a new password and signs the user in.
  const resetPassword = useCallback(
    async (phone: string, code: string, newPassword: string) => {
      const res = await api<Session>('/auth/password-reset/confirm', { method: 'POST', body: { phone, code, new_password: newPassword } });
      await save(res);
    },
    [save],
  );

  const value = useMemo(
    () => ({ user: session?.user ?? null, loading, signIn, register, resetPassword, signOut }),
    [session, loading, signIn, register, resetPassword, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
