import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import type { Paged } from './types';

/**
 * Cursor-paginated list (`?limit=&before=`). Reloads the first page on focus and pull-to-refresh;
 * `loadMore` appends the next page.
 */
export function usePaged<T extends { id: number }>(path: string, limit = 20) {
  const [items, setItems] = useState<T[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const hasData = useRef(false);

  const sep = path.includes('?') ? '&' : '?';

  const loadFirst = useCallback(
    async (pullToRefresh = false) => {
      if (pullToRefresh) setRefreshing(true);
      else if (!hasData.current) setLoading(true);
      try {
        const page = await api<Paged<T>>(`${path}${sep}limit=${limit}`);
        hasData.current = true;
        setItems(page.items);
        setNextBefore(page.next_before);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [path, sep, limit],
  );

  const loadMore = useCallback(async () => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api<Paged<T>>(`${path}${sep}limit=${limit}&before=${nextBefore}`);
      setItems((prev) => [...prev, ...page.items]);
      setNextBefore(page.next_before);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [path, sep, limit, nextBefore, loadingMore]);

  useFocusEffect(
    useCallback(() => {
      void loadFirst();
    }, [loadFirst]),
  );

  return {
    items,
    error,
    loading,
    refreshing,
    loadingMore,
    hasMore: nextBefore !== null,
    refresh: () => loadFirst(true),
    reload: () => loadFirst(),
    loadMore,
  };
}
