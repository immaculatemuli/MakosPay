import { router } from 'expo-router';
import { QrScanner } from '@/components/QrScanner';

/** Pay a fare: scan the QR sticker inside the vehicle, then confirm on the next screen. */
export default function Scan() {
  return <QrScanner onCode={(qr) => router.replace({ pathname: '/passenger/pay', params: { qr } })} />;
}
