import { useState } from 'react';
import { Chips, Empty, ErrorBox, List, ListRow, Loading, Screen, SectionTitle } from '@/components/ui';
import { dateTime } from '@/lib/format';
import type { OfficeRatings, RatingAverage } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

function Averages({ title, rows }: { title: string; rows: RatingAverage[] }) {
  if (!rows.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <List>
        {rows.map((r) => (
          <ListRow key={r.id} title={r.name} subtitle={`${r.count} rating${r.count === 1 ? '' : 's'}`} right={`${r.average.toFixed(1)} ★`} />
        ))}
      </List>
    </>
  );
}

/** What passengers said about their trips: the newest ratings (or only 1–2 stars), then averages, lowest first. */
export default function Ratings() {
  const [show, setShow] = useState<'all' | 'low'>('all');
  const low = show === 'low';
  const { data, error, loading, refreshing, refresh, reload } = useApi<OfficeRatings>(`/admin/ratings?low=${low ? 1 : 0}`);
  if (loading && !data) return <Loading />;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Chips
        options={[
          { value: 'all', label: 'All ratings' },
          { value: 'low', label: '1–2 stars' },
        ]}
        value={show}
        onChange={setShow}
      />
      <SectionTitle>Newest</SectionTitle>
      {data?.ratings.length === 0 && <Empty text={low ? 'No low ratings.' : 'No ratings yet. Passengers rate a trip on their ticket or when they arrive.'} />}
      {!!data?.ratings.length && (
        <List>
          {data.ratings.map((r) => (
            <ListRow
              key={r.id}
              title={`${stars(r.stars)}  ${r.plate}`}
              subtitle={[
                r.comment && `“${r.comment}”`,
                [r.driver_name && `Driver ${r.driver_name}`, r.conductor_name && `Conductor ${r.conductor_name}`].filter(Boolean).join(' · '),
                `${r.passenger_name} · ${r.route_name}${r.stop_name ? ` to ${r.stop_name}` : ''} · ${dateTime(r.created_at)}`,
              ]
                .filter(Boolean)
                .join('\n')}
            />
          ))}
        </List>
      )}
      {data && (
        <>
          <Averages title="Cars" rows={data.by_vehicle} />
          <Averages title="Drivers" rows={data.by_driver} />
          <Averages title="Conductors" rows={data.by_conductor} />
        </>
      )}
    </Screen>
  );
}
