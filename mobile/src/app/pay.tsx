import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth';

/**
 * Opened when a FarePay sticker (farepay://pay?v=<token>) is scanned with the phone's own camera.
 * Passengers go straight to the confirm-payment screen; anyone else goes to their home screen.
 */
export default function PayLink() {
  const { user } = useAuth();
  const { v } = useLocalSearchParams<{ v?: string }>();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== 'passenger' || !v) return <Redirect href="/" />;
  return <Redirect href={{ pathname: '/passenger/pay', params: { qr: `farepay://pay?v=${v}` } }} />;
}
