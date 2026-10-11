import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { MpesaResponse } from './types';

const CHECK_EVERY_MS = 3000;
const GIVE_UP_MS = 2 * 60 * 1000;

/**
 * Follows an M-Pesa PIN prompt: after `begin(response)`, checks the payment every few seconds until M-Pesa
 * confirms or rejects it. The server keeps checking on its own too, so closing the screen loses nothing.
 */
export function useMpesaPayment() {
  const [state, setState] = useState<MpesaResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const check = (id: number, startedAt: number) => {
    timer.current = setTimeout(async () => {
      try {
        const res = await api<MpesaResponse>(`/passenger/mpesa/${id}`);
        if (!mounted.current) return;
        setState(res);
        if (res.payment?.status === 'completed' || res.payment?.status === 'failed') return;
      } catch {
        // Temporary network problem: keep checking.
      }
      if (!mounted.current) return;
      if (Date.now() - startedAt > GIVE_UP_MS) setTimedOut(true);
      else check(id, startedAt);
    }, CHECK_EVERY_MS);
  };

  const begin = (response: MpesaResponse) => {
    setTimedOut(false);
    setState(response);
    const p = response.payment;
    if (p && (p.status === 'pending' || p.status === 'initiating')) check(p.id, Date.now());
  };

  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    setState(null);
    setTimedOut(false);
  };

  return { state, timedOut, begin, reset };
}
