import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import { api } from '@/lib/api';
import type { ConductorDay, Trip } from '@/lib/types';

const CHECK_EVERY_MS = 3000;
// Anything else that changes the screen (a trip started or finished): the whole list again now and then.
const FULL_RELOAD_EVERY_MS = 60_000;
const ALERT_SHOWN_MS = 8000;

const PAID_SOUND = require('../../../assets/sounds/paid.wav');

/**
 * The conductor's live payment feed. While today's payments are on screen, asks the server every few seconds
 * whether anything changed (a cheap check), and loads the list only when it did. Each new payment rings, vibrates
 * and shows as a big alert, so the conductor knows who paid without looking at the phone all the time.
 */
export function usePaymentFeed(day: ConductorDay | null, isToday: boolean, reload: () => Promise<void>) {
  const player = useAudioPlayer(PAID_SOUND);
  const lastCheck = useRef('');
  // The newest payment already seen (null until the list first loads: those payments don't ring).
  const seenId = useRef<number | null>(null);
  const [fresh, setFresh] = useState<Trip[]>([]);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isToday) return;
      const check = async () => {
        try {
          const latest = await api<{ latest_id: number; refunded: number }>('/crew/payments/latest');
          const key = `${latest.latest_id}:${latest.refunded}`;
          if (key !== lastCheck.current) {
            lastCheck.current = key;
            await reload();
          }
        } catch {
          // No network for a moment: try again at the next check.
        }
      };
      void check();
      const quick = setInterval(() => void check(), CHECK_EVERY_MS);
      const full = setInterval(() => void reload(), FULL_RELOAD_EVERY_MS);
      return () => {
        clearInterval(quick);
        clearInterval(full);
      };
    }, [isToday, reload]),
  );

  // Ring for payments newer than the last one seen.
  useEffect(() => {
    if (!day || !isToday) return;
    const newest = day.payments.reduce((max, p) => Math.max(max, p.id), 0);
    if (seenId.current === null) {
      seenId.current = newest;
      return;
    }
    const since = seenId.current;
    seenId.current = Math.max(since, newest);
    const added = day.payments.filter((p) => p.id > since && p.status === 'paid');
    if (!added.length) return;
    setFresh(added);
    Vibration.vibrate([0, 300, 150, 300]);
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // No sound (e.g. the phone is busy with a call): the vibration and the alert still show.
    }
  }, [day, isToday, player]);

  useEffect(() => {
    if (!fresh.length) return;
    const timer = setTimeout(() => setFresh([]), ALERT_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  return { fresh, dismiss: () => setFresh([]) };
}
