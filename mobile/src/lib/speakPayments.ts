import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import type { Language } from './i18n';
import type { Trip } from './types';

// The crew's choice, kept on the phone: payments are read aloud unless they switched it off.
const KEY = 'farepay.speakPayments';

export const speakingOn = async () => (await SecureStore.getItemAsync(KEY).catch(() => null)) !== 'off';
export const setSpeaking = (on: boolean) => SecureStore.setItemAsync(KEY, on ? 'on' : 'off').catch(() => {});

let swahiliVoice: boolean | null = null;
async function hasSwahiliVoice() {
  if (swahiliVoice === null) {
    const voices = await Speech.getAvailableVoicesAsync().catch(() => []);
    swahiliVoice = voices.some((v) => v.language?.toLowerCase().startsWith('sw'));
  }
  return swahiliVoice;
}

/**
 * Says the new payments out loud, e.g. "100 shillings paid, to Nairobi", so a driver alone on the car hears who
 * paid without looking at the phone. Kiswahili when the app is in Kiswahili and the phone has a Kiswahili voice.
 */
export async function announcePayments(payments: Trip[], language: Language) {
  if (!payments.length) return;
  const sw = language === 'sw' && (await hasSwahiliVoice());
  const lines = payments.slice(0, 3).map((p) => {
    const place = p.stop_name ?? p.route_name;
    if (p.free_ride) return sw ? `Safari ya bure, kwenda ${place}` : `Free ride, to ${place}`;
    return sw ? `Shilingi ${p.fare} zimelipwa, kwenda ${place}` : `${p.fare} shillings paid, to ${place}`;
  });
  if (payments.length > 3) lines.push(sw ? `Na wengine ${payments.length - 3}` : `And ${payments.length - 3} more`);
  Speech.speak(lines.join('. '), { language: sw ? 'sw-KE' : 'en-GB', rate: 0.95 });
}
