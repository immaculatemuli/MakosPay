import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Text } from 'react-native';
import { Badge, Button, Card, colors, ErrorBox, KeyValue, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { displayPhone } from '@/lib/format';
import type { Vehicle } from '@/lib/types';
import { useApi } from '@/lib/useApi';

export default function VehicleDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicle = useApi<Vehicle>(`/admin/vehicles/${id}`);
  const qr = useApi<{ plate: string; file_name: string; png_base64: string }>(`/admin/vehicles/${id}/qr`);
  const [sharing, setSharing] = useState(false);

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
    confirm('Replace QR code?', 'The current sticker stops working straight away. Print and stick the new one in the vehicle.', 'Replace', async () => {
      await api(`/admin/vehicles/${v.id}/rotate-qr`, { method: 'POST' });
      await qr.reload();
    });

  // Saves the picture as a PNG file, then opens Android's share menu (Save to Photos/Files, WhatsApp, Email, Print...).
  const shareQr = async () => {
    if (!qr.data) return;
    setSharing(true);
    try {
      const file = new File(Paths.cache, qr.data.file_name);
      if (file.exists) file.delete();
      file.create();
      file.write(qr.data.png_base64, { encoding: 'base64' });
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
      await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: `QR code for ${v.plate}` });
    } catch (err) {
      Alert.alert('Could not share the QR code', errorMessage(err));
    } finally {
      setSharing(false);
    }
  };

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
        {!!v.owner_id && (
          <Button title={`All of ${v.owner_name}’s cars`} variant="secondary" icon="people-outline" onPress={() => router.push(`/admin/owner/${v.owner_id}`)} />
        )}
        <KeyValue label="Owner's phone" value={displayPhone(v.owner_phone)} />
        <KeyValue
          label="Owner is paid to"
          value={v.owner_payout_method === 'bank' ? `${v.owner_bank_name} (paybill ${v.owner_bank_paybill}) acc ${v.owner_bank_account}` : 'M-Pesa'}
        />
        <KeyValue label="Conductor" value={v.conductor_name ?? 'None'} />
        <KeyValue label="Driver" value={v.driver_name ?? 'None'} />
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
        {qr.data ? (
          <Image source={{ uri: `data:image/png;base64,${qr.data.png_base64}` }} style={{ width: 260, height: 260 }} accessibilityLabel={`QR code for ${v.plate}`} />
        ) : qr.error ? (
          <ErrorBox message={qr.error} onRetry={qr.reload} />
        ) : (
          <ActivityIndicator style={{ height: 260 }} color={colors.primary} />
        )}
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 }}>{v.plate}</Text>
        <Muted center>
          Passengers scan this code to pay. Tap the button below to save it to your phone or send it (WhatsApp, email) and print it. Stick it inside
          the vehicle where passengers can see it.
        </Muted>
      </Card>
      <Button title="Save or share QR code" icon="share-outline" onPress={shareQr} loading={sharing} disabled={!qr.data} />
      <Button title="Replace QR code" variant="danger" icon="refresh" onPress={replaceQr} />
      <Button title={v.is_active ? 'Stop using this vehicle' : 'Use this vehicle again'} variant={v.is_active ? 'danger' : 'secondary'} onPress={toggleActive} />
    </Screen>
  );
}
