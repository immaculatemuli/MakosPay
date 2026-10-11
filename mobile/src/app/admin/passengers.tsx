import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Field, List, ListRow, Loading, Screen } from '@/components/ui';
import { displayPhone, kes } from '@/lib/format';
import { useApi } from '@/lib/useApi';

interface PassengerRow {
  id: number;
  name: string;
  phone: string;
  wallet_balance: number | null;
  trips: number;
}

/** Find a passenger by name or phone, e.g. to set a new password for them. */
export default function Passengers() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  // Search shortly after the office stops typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);
  const list = useApi<PassengerRow[]>(`/admin/passengers${query ? `?q=${encodeURIComponent(query)}` : ''}`);

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
      <Field label="Search" placeholder="Name or phone number" value={search} onChangeText={setSearch} autoCorrect={false} />
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <Empty text={query ? 'No passenger matches.' : 'No passengers yet.'} />}
      {!!list.data?.length && (
        <List>
          {list.data.map((p) => (
            <ListRow
              key={p.id}
              icon="person-outline"
              title={p.name}
              subtitle={`${displayPhone(p.phone)} · ${p.trips} trip${p.trips === 1 ? '' : 's'}`}
              right={kes(p.wallet_balance ?? 0)}
              onPress={() => router.push({ pathname: '/admin/set-password', params: { id: p.id, name: p.name, phone: p.phone } })}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
