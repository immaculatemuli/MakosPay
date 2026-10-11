import type { Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { ROLE_HOME, type Role } from './types';

const POLL_EVERY_MS = 30_000;

// One shared unread count for every bell on screen, checked every 30 seconds while any bell is showing.
let unread = 0;
const listeners = new Set<(n: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function setUnread(n: number) {
  unread = n;
  listeners.forEach((listener) => listener(n));
}

export async function refreshUnread() {
  try {
    setUnread((await api<{ unread: number }>('/notifications/unread')).unread);
  } catch {
    // Offline or signed out: keep the last number; the next check will try again.
  }
}

/** The number on the bell. */
export function useUnread() {
  const [count, setCount] = useState(unread);
  useEffect(() => {
    listeners.add(setCount);
    if (listeners.size === 1) {
      void refreshUnread();
      timer = setInterval(() => void refreshUnread(), POLL_EVERY_MS);
    }
    // Opening the app again shows new notifications straight away.
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void refreshUnread());
    return () => {
      sub.remove();
      listeners.delete(setCount);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return count;
}

/** The screen a notification is about, for this person's part of the app (null: nothing to open). */
export function targetHref(role: Role, target: string | null): Href | null {
  if (!target) return null;
  const home = ROLE_HOME[role];
  const [kind, id] = target.split(':');
  if (home === '/passenger') {
    if (kind === 'wallet') return '/passenger/wallet';
    if (kind === 'trips') return '/passenger/trips';
    if (kind === 'reports') return '/passenger/reports';
    if (kind === 'fare-changes') return '/passenger/fare-changes';
    if (kind === 'withdrawals') return '/passenger/withdraw';
  }
  if (home === '/conductor' || home === '/driver') {
    if (kind === 'reports') return `${home}/reports`;
  }
  if (home === '/admin') {
    if (kind === 'reports') return '/admin/reports';
    if (kind === 'payouts') return '/admin/payouts';
    if (kind === 'payout' && id) return `/admin/payout/${id}`;
    if (kind === 'money-check') return '/admin/reconciliation';
    if (kind === 'withdrawals') return '/admin/withdrawals';
  }
  return null;
}
