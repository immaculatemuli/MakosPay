import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Empty, ErrorBox, Field, List, ListRow, Loading, Muted, Screen } from '@/components/ui';
import { kes } from '@/lib/format';
import { officeHref } from '@/lib/officeLinks';
import { useApi } from '@/lib/useApi';

interface SearchResult {
  kind: 'vehicle' | 'person' | 'payment' | 'booking' | 'parcel';
  id: number;
  title: string;
  subtitle: string;
  link: string | null;
  payment?: { id: number; ticket: string; fare: number; plate: string; stop: string; passenger: string; paid_out: boolean; refunded: boolean };
}

const ICON = { vehicle: 'bus-outline', person: 'person-outline', payment: 'receipt-outline', booking: 'ticket-outline', parcel: 'cube-outline' } as const;

/** One search box for everything: a plate, a name, a phone number, a ticket, booking or parcel code. */
export default function Search() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  // Search shortly after the office stops typing.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const results = useApi<SearchResult[]>(query.length >= 2 ? `/admin/search?q=${encodeURIComponent(query)}` : null);

  const open = (r: SearchResult) => {
    // A payment: its details, and a refund if it can still be refunded.
    if (r.payment) {
      const p = r.payment;
      return Alert.alert(`Ticket ${p.ticket}`, `${p.passenger}\n${p.plate}${p.stop ? ` · to ${p.stop}` : ''}\n${kes(p.fare)}${p.refunded ? '\nRefunded' : ''}`, [
        { text: 'Close', style: 'cancel' },
        ...(p.refunded
          ? []
          : [
              {
                text: 'Refund…',
                onPress: () =>
                  router.push({
                    pathname: '/admin/refund',
                    params: { id: String(p.id), passenger: p.passenger, plate: p.plate, stop: p.stop, fare: String(p.fare), ticket: p.ticket, paidOut: p.paid_out ? '1' : '0' },
                  }),
              },
            ]),
      ]);
    }
    const href = officeHref(r.link);
    if (href) router.push(href);
  };

  return (
    <Screen>
      <Field label="Search" placeholder="Plate, name, phone, ticket or parcel code" value={text} onChangeText={setText} autoFocus autoCorrect={false} />
      {query.length < 2 && <Muted>Type at least 2 letters or numbers.</Muted>}
      {results.loading && query.length >= 2 && !results.data && <Loading />}
      {results.error && <ErrorBox message={results.error} onRetry={results.reload} />}
      {query.length >= 2 && results.data?.length === 0 && <Empty text="Nothing found." />}
      {!!results.data?.length && query.length >= 2 && (
        <List>
          {results.data.map((r) => (
            <ListRow key={`${r.kind}-${r.id}`} icon={ICON[r.kind]} title={r.title} subtitle={r.subtitle} onPress={() => open(r)} />
          ))}
        </List>
      )}
    </Screen>
  );
}
