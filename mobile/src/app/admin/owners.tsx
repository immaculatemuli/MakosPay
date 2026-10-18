import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Empty, ErrorBox, Field, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { displayPhone, kes } from '@/lib/format';
import { useApi } from '@/lib/useApi';

interface OwnerRow {
  id: number;
  name: string;
  phone: string;
  payout_method: 'mpesa' | 'bank';
  bank_name: string | null;
  vehicle_count: number;
  today_total: number;
  owed: number;
}

/** Vehicle owners: one can have many cars; each evening they get one payment for all their cars' fares. */
export default function Owners() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const list = useApi<OwnerRow[]>(`/admin/owners${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
      <Button title="Add owner" icon="person-add-outline" onPress={() => router.push('/admin/owner-form')} />
      <Field label="Search" placeholder="Name or phone" value={text} onChangeText={setText} autoCorrect={false} />
      {list.loading && !list.data && <Loading />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <Empty text={q ? 'No owner found.' : 'No owners yet. They are added with their first vehicle.'} />}
      {!!list.data?.length && (
        <List>
          {list.data.map((o) => (
            <ListRow
              key={o.id}
              icon="person-outline"
              title={o.name}
              subtitle={`${o.vehicle_count} car${o.vehicle_count === 1 ? '' : 's'} · ${displayPhone(o.phone)} · ${o.payout_method === 'bank' ? `Bank (${o.bank_name})` : 'M-Pesa'}`}
              right={kes(o.today_total)}
              rightSub={<Muted>{`Tonight ${kes(o.owed)}`}</Muted>}
              onPress={() => router.push(`/admin/owner/${o.id}`)}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
