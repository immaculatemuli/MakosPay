import { useState } from 'react';
import { Text, View } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Field, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { time } from '@/lib/format';
import type { CrewParcel, CrewParcels as Data } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/**
 * Parcels: paid ones waiting at the office for this route (load them onto the car), and the ones on the car (mark
 * them arrived, and hand them over when the receiver gives the 6-digit collection code). Ticking a stop on the trip
 * also marks its parcels arrived.
 */
export function CrewParcels() {
  const parcels = useApi<Data>('/crew/parcels');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handing, setHanding] = useState<number | null>(null);
  const [code, setCode] = useState('');

  if (parcels.loading && !parcels.data) return <Loading />;
  const d = parcels.data;

  const act = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    setError(null);
    try {
      parcels.setData(await api<Data>(path, { method: 'POST', body }));
      setHanding(null);
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const heading = (p: CrewParcel) => (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', letterSpacing: 1.5, color: colors.text }}>{p.tracking_code}</Text>
        {p.status === 'arrived' ? <Badge text="Arrived" tone="success" /> : p.status === 'on_the_way' ? <Badge text="On the car" /> : <Badge text="At the office" tone="warning" />}
      </View>
      <Text style={{ color: colors.text, fontWeight: '600', marginTop: 4 }}>To {p.stop_name}{p.description ? ` · ${p.description}` : ''}</Text>
      <Muted>
        For {p.receiver_name} · {p.receiver_phone}
      </Muted>
    </>
  );

  return (
    <Screen refreshing={parcels.refreshing} onRefresh={parcels.refresh}>
      {(parcels.error || error) && <ErrorBox message={(error ?? parcels.error)!} onRetry={error ? undefined : parcels.reload} />}

      <SectionTitle>On this car</SectionTitle>
      {d?.on_car.length === 0 && <Empty text="No parcels on the car." />}
      {d?.on_car.map((p) => (
        <Card key={p.id}>
          {heading(p)}
          {p.loaded_at && <Muted>Loaded {time(p.loaded_at)}{p.arrived_at ? ` · arrived ${time(p.arrived_at)}` : ''}</Muted>}
          {handing === p.id ? (
            <>
              <Field
                label="Receiver's 6-digit collection code"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
                hint="Ask the receiver for it. Hand the parcel over only if it is right."
              />
              <Button title="Hand over" icon="checkmark" disabled={code.length !== 6} loading={busy === `collect-${p.id}`} onPress={() => void act(`collect-${p.id}`, `/crew/parcels/${p.id}/collect`, { code })} />
              <Button title="Not now" variant="secondary" onPress={() => setHanding(null)} />
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {p.status === 'on_the_way' && (
                <View style={{ flex: 1 }}>
                  <Button title="Arrived" variant="secondary" loading={busy === `arrive-${p.id}`} onPress={() => void act(`arrive-${p.id}`, `/crew/parcels/${p.id}/arrive`)} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button
                  title="Hand over"
                  icon="person-outline"
                  onPress={() => {
                    setCode('');
                    setHanding(p.id);
                  }}
                />
              </View>
            </View>
          )}
        </Card>
      ))}

      <SectionTitle>Waiting at the office for your route</SectionTitle>
      {d?.waiting.length === 0 && <Empty text="No paid parcels waiting for your route." />}
      {d?.waiting.map((p) => (
        <Card key={p.id}>
          {heading(p)}
          <Muted>Recorded {time(p.created_at)}</Muted>
          <Button title="Loaded onto the car" icon="cube-outline" loading={busy === `load-${p.id}`} onPress={() => void act(`load-${p.id}`, `/crew/parcels/${p.id}/load`)} />
        </Card>
      ))}
    </Screen>
  );
}
