import { useState } from 'react';
import { Text, View } from 'react-native';
import { Badge, Button, Card, colors, Empty, ErrorBox, Field, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { time } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { CrewParcel, CrewParcels as Data } from '@/lib/types';
import { useApi } from '@/lib/useApi';

/**
 * Parcels: paid ones waiting at the office for this route (load them onto the car), and the ones on the car (mark
 * them arrived, and hand them over when the receiver gives the 6-digit collection code). Ticking a stop on the trip
 * also marks its parcels arrived.
 */
export function CrewParcels() {
  const { t } = useT();
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
        {p.status === 'arrived' ? <Badge text={t('Arrived')} tone="success" /> : p.status === 'on_the_way' ? <Badge text={t('On the car')} /> : <Badge text={t('At the office')} tone="warning" />}
      </View>
      <Text style={{ color: colors.text, fontWeight: '600', marginTop: 4 }}>{t('To {place}', { place: p.stop_name })}{p.description ? ` · ${p.description}` : ''}</Text>
      <Muted>
        {t('For {name}', { name: p.receiver_name })} · {p.receiver_phone}
      </Muted>
    </>
  );

  return (
    <Screen refreshing={parcels.refreshing} onRefresh={parcels.refresh}>
      {(parcels.error || error) && <ErrorBox message={(error ?? parcels.error)!} onRetry={error ? undefined : parcels.reload} />}

      <SectionTitle>{t('On this car')}</SectionTitle>
      {d?.on_car.length === 0 && <Empty text={t('No parcels on the car.')} />}
      {d?.on_car.map((p) => (
        <Card key={p.id}>
          {heading(p)}
          {p.loaded_at && <Muted>{t('Loaded {time}', { time: time(p.loaded_at) })}{p.arrived_at ? ` · ${t('arrived {time}', { time: time(p.arrived_at) })}` : ''}</Muted>}
          {handing === p.id ? (
            <>
              <Field
                label={t('Receiver’s 6-digit collection code')}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(typed) => setCode(typed.replace(/\D/g, ''))}
                hint={t('Ask the receiver for it. Hand the parcel over only if it is right.')}
              />
              <Button title={t('Hand over')} icon="checkmark" disabled={code.length !== 6} loading={busy === `collect-${p.id}`} onPress={() => void act(`collect-${p.id}`, `/crew/parcels/${p.id}/collect`, { code })} />
              <Button title={t('Not now')} variant="secondary" onPress={() => setHanding(null)} />
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {p.status === 'on_the_way' && (
                <View style={{ flex: 1 }}>
                  <Button title={t('Arrived')} variant="secondary" loading={busy === `arrive-${p.id}`} onPress={() => void act(`arrive-${p.id}`, `/crew/parcels/${p.id}/arrive`)} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button
                  title={t('Hand over')}
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

      <SectionTitle>{t('Waiting at the office for your route')}</SectionTitle>
      {d?.waiting.length === 0 && <Empty text={t('No paid parcels waiting for your route.')} />}
      {d?.waiting.map((p) => (
        <Card key={p.id}>
          {heading(p)}
          <Muted>{t('Recorded {time}', { time: time(p.created_at) })}</Muted>
          <Button title={t('Loaded onto the car')} icon="cube-outline" loading={busy === `load-${p.id}`} onPress={() => void act(`load-${p.id}`, `/crew/parcels/${p.id}/load`)} />
        </Card>
      ))}
    </Screen>
  );
}
