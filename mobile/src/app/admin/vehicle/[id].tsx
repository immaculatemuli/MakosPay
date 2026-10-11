import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Image, Text } from 'react-native';
import { Badge, Button, Card, colors, ErrorBox, KeyValue, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, authHeader, errorMessage, getApiUrl } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import type { Vehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';

export default function VehicleDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicle = useApi<Vehicle>(`/admin/vehicles/${id}`);

  if (vehicle.loading && !vehicle.data) return <Loading />;
  const v = vehicle.data;
  if (!v) return <Screen><ErrorBox message={vehicle.error ?? 'Vehicle not found.'} onRetry={vehicle.reload} /></Screen>;

  const confirm = (title: string, message: string, action: string, run: () => Promise<unknown>, destructive = true) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: destructive ? 'destructive' : 'default',
        onPress: async () => {
          try {
            await run();
            await vehicle.reload();
          } catch (err) {
            Alert.alert('Something went wrong', errorMessage(err));
          }
        },
      },
    ]);

  const replaceQr = () =>
    confirm('Replace QR code?', 'The current sticker stops working straight away. Print and stick the new one in the vehicle.', 'Replace', () =>
      api(`/admin/vehicles/${v.id}/rotate-qr`, { method: 'POST' }),
    );

  const toggleActive = () =>
    v.is_active
      ? confirm('Stop using this vehicle?', 'Passengers will not be able to pay on it.', 'Stop using', () =>
          api(`/admin/vehicles/${v.id}`, { method: 'PATCH', body: { is_active: false } }),
        )
      : confirm('Use this vehicle again?', '', 'Use again', () => api(`/admin/vehicles/${v.id}`, { method: 'PATCH', body: { is_active: true } }), false);

  return (
    <Screen refreshing={vehicle.refreshing} onRefresh={vehicle.refresh}>
      <Card>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>{v.plate}</Text>
        {!v.is_active && <Badge text="Not in use" tone="danger" />}
        {v.description && <Muted>{v.description}</Muted>}
        <KeyValue label="Owner" value={v.owner_name} />
        <KeyValue label="Owner's phone" value={displayPhone(v.owner_phone)} />
        <KeyValue
          label="Owner is paid to"
          value={v.owner_payout_method === 'bank' ? `${v.owner_bank_name} (paybill ${v.owner_bank_paybill}) acc ${v.owner_bank_account}` : 'M-Pesa'}
        />
        <KeyValue label="Conductor" value={v.conductor_name ?? 'None'} />
        <KeyValue label="Route" value={v.route_name ?? 'None yet'} />
      </Card>
      <Button
        title="Edit vehicle"
        variant="secondary"
        icon="create-outline"
        onPress={() => router.push({ pathname: '/admin/vehicle-form', params: { id: v.id } })}
      />

      <SectionTitle>QR sticker</SectionTitle>
      <Card style={{ alignItems: 'center' }}>
        <Image
          // The token in the address makes the picture refresh after the code is replaced.
          source={{ uri: `${getApiUrl()}/admin/vehicles/${v.id}/qr.png?t=${v.qr_token}`, headers: authHeader() }}
          style={{ width: 240, height: 240 }}
          accessibilityLabel={`QR code for ${v.plate}`}
        />
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 }}>{v.plate}</Text>
        <Muted center>Take a screenshot of this code and print it. Stick it inside the vehicle where passengers can scan it.</Muted>
      </Card>
      <Button title="Replace QR code" variant="danger" icon="refresh" onPress={replaceQr} />
      <Button title={v.is_active ? 'Stop using this vehicle' : 'Use this vehicle again'} variant={v.is_active ? 'danger' : 'secondary'} onPress={toggleActive} />
    </Screen>
  );
}
