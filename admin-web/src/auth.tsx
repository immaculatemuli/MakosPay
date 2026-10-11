import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, whenSignedOut } from './api';
import type { User } from './types';

interface AuthValue {
  user: User | null;
  checking: boolean;
  signIn: (phone: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Who is signed in. The sign-in itself is an HttpOnly cookie; we only ask the API who it belongs to. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    whenSignedOut(() => setUser(null));
    api<{ user: User | null }>('/auth/web/session')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const signIn = useCallback(async (phone: string, password: string) => {
    const r = await api<{ user: User }>('/auth/web/login', { method: 'POST', body: { phone, password } });
    setUser(r.user);
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/web/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, checking, signIn, signOut }), [user, checking, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
