import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Chips, Empty, ErrorBox, Field, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { dateTime, kes } from '@/lib/format';
import { PARCEL_WORD } from '@/lib/parcels';
import type { OfficeParcel } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/** Parcels sent through the office: find one, filter by where it is, and record a new one. */
export default function Parcels() {
  const [status, setStatus] = useState<OfficeParcel['status'] | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const params = new URLSearchParams({ ...(status && { status }), ...(query && { search: query }) }).toString();
  const list = useApi<{ parcels: OfficeParcel[]; last_30_days: { paid: number; fees: number } }>(`/admin/parcels${params ? `?${params}` : ''}`);

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh}>
      <Button title="Record a parcel" icon="add-circle-outline" onPress={() => router.push('/admin/parcel-form')} />
      {list.data && (
        <Card>
          <Muted>
            Parcel fees, last 30 days: {kes(list.data.last_30_days.fees)} from {list.data.last_30_days.paid} paid parcel{list.data.last_30_days.paid === 1 ? '' : 's'}. SACCO income, not part of owner payouts.
          </Muted>
        </Card>
      )}
      <Field
        label="Find a parcel"
        placeholder="Tracking code, name or phone"
        autoCapitalize="characters"
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => setQuery(search.trim())}
        returnKeyType="search"
      />
      <Chips
        options={[{ value: '' as OfficeParcel['status'] | '', label: 'All' }, ...(Object.keys(PARCEL_WORD) as OfficeParcel['status'][]).map((s) => ({ value: s as OfficeParcel['status'] | '', label: PARCEL_WORD[s] }))]}
        value={status}
        onChange={setStatus}
      />
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Loading />}
      {list.data?.parcels.length === 0 && <Empty text="No parcels here." />}
      {!!list.data?.parcels.length && (
        <List>
          {list.data.parcels.map((p) => (
            <ListRow
              key={p.id}
              icon="cube-outline"
              title={`${p.tracking_code} · to ${p.stop_name}`}
              subtitle={`${p.sender_name} → ${p.receiver_name} · ${dateTime(p.created_at)}`}
              right={PARCEL_WORD[p.status]}
              onPress={() => router.push({ pathname: '/admin/parcel/[id]', params: { id: String(p.id) } })}
            />
          ))}
        </List>
      )}
    </Screen>
  );
}
