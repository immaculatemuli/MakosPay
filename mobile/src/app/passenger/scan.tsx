import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, colors, Loading, Muted, Screen } from '@/components/ui';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  // Allow scanning again when the passenger comes back to this screen.
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
    }, []),
  );

  const goPay = (qr: string) => {
    if (handled.current || !qr.trim()) return;
    handled.current = true;
    router.replace({ pathname: '/passenger/pay', params: { qr: qr.trim() } });
  };

  if (!permission) return <Loading />;

  if (!permission.granted) {
    return (
      <Screen>
        <Muted>FarePay needs the camera to scan the QR code inside the vehicle.</Muted>
        <View style={{ height: 16 }} />
        <Button title="Allow camera" icon="camera-outline" onPress={requestPermission} />
        {!permission.canAskAgain && <Muted>Camera access is blocked. Turn it on for Expo Go / FarePay in your phone settings.</Muted>}
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => goPay(data)}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Point the camera at the FarePay QR code inside the vehicle</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 32 },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: colors.primarySoft, borderRadius: 20 },
  hint: { color: '#fff', marginTop: 24, textAlign: 'center', fontSize: 16, fontWeight: '600' },
});
