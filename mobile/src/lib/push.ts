import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

// A notification that arrives while the app is open is shown too.
Notifications.setNotificationHandler({
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
  // Expo Go on Android can't receive push (and asking shows a warning): only the APK registers.
  if (Platform.OS === 'android' && Constants.executionEnvironment === 'storeClient') return;
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

/** Signing out: this phone stops getting the person's notifications. */
export async function unregisterPush() {
  if (!registered) return;
  const token = registered;
  registered = null;
  await api('/notifications/push-token/remove', { method: 'POST', body: { token } }).catch(() => {});
}
