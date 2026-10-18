import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Button, Chips, colors, ErrorBox, Field, Muted, Notice, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Route } from '@/lib/types';
import { useApi } from '@/lib/useApi';

type Audience = 'drivers' | 'crew' | 'marshals';

/** One message to many crew at once (e.g. a road closure): under their bell and as a notification, optionally by SMS. */
export default function Broadcast() {
  const routes = useApi<Route[]>('/admin/routes');
  const [audience, setAudience] = useState<Audience>('drivers');
  const [routeId, setRouteId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [sms, setSms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const onRoute = audience !== 'marshals' && routeId !== null;
  const count = useApi<{ count: number }>(`/admin/broadcast/count?audience=${audience}${onRoute ? `&route_id=${routeId}` : ''}`);

  const send = async () => {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const r = await api<{ sent_to: number; by_sms: boolean }>('/admin/broadcast', {
        method: 'POST',
        body: { audience, route_id: onRoute ? routeId : null, message: message.trim(), sms },
      });
      setSent(`Sent to ${r.sent_to} ${r.sent_to === 1 ? 'person' : 'people'}${r.by_sms ? ', also by SMS' : ''}.`);
      setMessage('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Chips
        label="Send to"
        options={[
          { value: 'drivers' as const, label: 'Drivers' },
          { value: 'crew' as const, label: 'Drivers and conductors' },
          { value: 'marshals' as const, label: 'Stage marshals' },
        ]}
        value={audience}
        onChange={setAudience}
      />
      {audience !== 'marshals' && (
        <Chips
          label="On route"
          options={[{ value: null as number | null, label: 'All routes' }, ...(routes.data ?? []).map((r) => ({ value: r.id as number | null, label: r.name }))]}
          value={routeId}
          onChange={setRouteId}
        />
      )}
      <Field
        label={`Message (${message.trim().length}/300)`}
        placeholder="e.g. Thika Road closed at Juja, use the bypass."
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={300}
        style={{ minHeight: 100, textAlignVertical: 'top' }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>Also send by SMS (costs one text each)</Text>
        <Switch value={sms} onValueChange={setSms} trackColor={{ true: colors.primary }} />
      </View>
      {error && <ErrorBox message={error} />}
      {sent && <Notice tone="success">{sent}</Notice>}
      <Button
        title={count.data ? `Send to ${count.data.count} ${count.data.count === 1 ? 'person' : 'people'}` : 'Send'}
        icon="megaphone-outline"
        onPress={send}
        loading={busy}
        disabled={message.trim().length < 3 || !count.data?.count}
      />
      <Muted>It arrives under their bell and as a notification on their phone.</Muted>
    </Screen>
  );
}
