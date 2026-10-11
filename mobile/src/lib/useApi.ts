import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, errorMessage } from './api';

/**
 * Loads `path` whenever the screen comes into focus. The first load shows a spinner;
 * later loads (focus, pull-to-refresh) keep the old data on screen while refreshing.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);

  const load = useCallback(
    async (pullToRefresh = false) => {
      if (!path) return;
      if (pullToRefresh) setRefreshing(true);
      else if (!hasData.current) setLoading(true);
      try {
        const result = await api<T>(path);
        hasData.current = true;
        setData(result);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Stable across renders, so screens can use them in effects and timers.
  const reload = useCallback(() => load(), [load]);
  const refresh = useCallback(() => load(true), [load]);

  return { data, setData, error, loading, refreshing, reload, refresh };
}
