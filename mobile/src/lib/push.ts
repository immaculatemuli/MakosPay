import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

// Expo Go on Android can't receive push, and even loading expo-notifications there crashes the app:
// so it is only loaded where push works (the APK, and iOS).
const pushAvailable = !(Platform.OS === 'android' && Constants.executionEnvironment === 'storeClient');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications: typeof import('expo-notifications') | null = pushAvailable ? require('expo-notifications') : null;

// A notification that arrives while the app is open is shown too.
Notifications?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// The token this phone registered for the signed-in person (to unregister on sign-out).
let registered: string | null = null;

/**
 * Asks to show notifications and registers this phone for push, so notices arrive while the app is closed.
 * Never stops sign-in: if anything fails (Expo Go on Android can't receive push, push not set up in the APK yet,
 * no permission, offline) the notices are still in the app under the bell.
 */
export async function registerForPush() {
  if (!Notifications) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'FarePay', importance: Notifications.AndroidImportance.HIGH, lightColor: '#D4268F' });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('/notifications/push-token', { method: 'POST', body: { token } });
    registered = token;
  } catch {
    // See above: the in-app notifications still work.
  }
}

/** Runs `onTap` when a push notification is tapped. Returns a function that stops listening. */
export function onNotificationTap(onTap: () => void) {
  const sub = Notifications?.addNotificationResponseReceivedListener(onTap);
  return () => sub?.remove();
}

/** Signing out: this phone stops getting the person's notifications. */
export async function unregisterPush() {
  if (!registered) return;
  const token = registered;
  registered = null;
  await api('/notifications/push-token/remove', { method: 'POST', body: { token } }).catch(() => {});
}
