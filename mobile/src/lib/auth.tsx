import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, configureAuth } from './api';
import { registerForPush, unregisterPush } from './push';
import { forgetSavedTickets, setTicketOwner } from './savedTickets';
import type { User } from './types';

// Older versions kept the sign-in on the phone; it is deleted at start-up. Passengers and the office sign in each
// time the app starts. Crew and marshals (who open the app many times a day) stay signed in for one shift.
const OLD_SESSION_KEY = 'farepay.session';
// Older versions let the server address be changed on the sign-in screen and kept it; it is deleted at start-up too.
const OLD_SERVER_KEY = 'farepay.serverUrl';
const SHIFT_KEY = 'farepay.shift';
const SHIFT_HOURS = 12;
const SHIFT_ROLES: User['role'][] = ['conductor', 'driver', 'marshal'];
// The last phone number signed in with (not the password), to fill in the sign-in form.
const LAST_PHONE_KEY = 'farepay.lastPhone';

export const lastPhoneNumber = () => SecureStore.getItemAsync(LAST_PHONE_KEY).catch(() => null);

interface Session {
  token: string;
  user: User;
}

/** The crew member's sign-in saved on the phone (encrypted), and when the shift ends. */
interface Shift extends Session {
  until: number;
}

async function savedShift(): Promise<Shift | null> {
  try {
    const raw = await SecureStore.getItemAsync(SHIFT_KEY);
    const shift = raw ? (JSON.parse(raw) as Shift) : null;
    return shift && shift.until > Date.now() && SHIFT_ROLES.includes(shift.user.role) ? shift : null;
  } catch {
    return null;
  }
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

  // Kept in memory (crew: also on the phone until the shift ends). Signed in: this phone is registered for push.
  const save = useCallback(async (next: Session | null) => {
    configureAuth(next?.token ?? null);
    setTicketOwner(next?.user.role === 'passenger' ? next.user.phone : null);
    setSession(next);
    if (next && SHIFT_ROLES.includes(next.user.role)) {
      const shift: Shift = { ...next, until: Date.now() + SHIFT_HOURS * 3600_000 };
      await SecureStore.setItemAsync(SHIFT_KEY, JSON.stringify(shift)).catch(() => {});
    } else {
      await SecureStore.deleteItemAsync(SHIFT_KEY).catch(() => {});
    }
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
        await SecureStore.deleteItemAsync(OLD_SERVER_KEY).catch(() => {});
        await SecureStore.deleteItemAsync(OLD_SESSION_KEY).catch(() => {});
        // A crew member still on their shift goes straight in (the shift's end is kept, not extended).
        const shift = await savedShift();
        if (shift) {
          configureAuth(shift.token);
          setSession({ token: shift.token, user: shift.user });
          // Their details as they are now; a changed password or a removed account signs them out (401).
          api<{ user: User }>('/auth/me')
            .then((res) => setSession((current) => (current?.token === shift.token ? { ...current, user: res.user } : current)))
            .catch(() => {});
          void registerForPush();
        } else {
          await SecureStore.deleteItemAsync(SHIFT_KEY).catch(() => {});
        }
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
