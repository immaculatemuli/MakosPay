import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

/**
 * Loads `path` (again whenever it changes); `reload` fetches it again, e.g. after a change, and `setData` shows
 * what an action answered without asking again.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const latest = useRef(path);

  const load = useCallback(async () => {
    if (!path) return;
    latest.current = path;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (latest.current === path) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (latest.current === path) setError(errorText(err));
    } finally {
      if (latest.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, setData, error, loading, reload: load };
}
