import Constants from 'expo-constants';
import { useEffect } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { api } from './api';
import { t } from './i18n';

/** This phone's app version (the APK's: an over-the-air update keeps the same version). */
const installed = Constants.expoConfig?.version ?? '0.0.0';

/** -1, 0 or 1: "1.2.0" against "1.10.0", part by part. */
function compare(a: string, b: string) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

let askedLater = false;

/**
 * On opening (and coming back to) the app, asks the server for the newest APK. Too old to work: must download it.
 * Older than the newest: offered once per launch.
 */
export function useAppVersionCheck() {
  useEffect(() => {
    const check = async () => {
      const v = await api<{ latest: string | null; minimum: string | null; download_url: string }>('/app-version').catch(() => null);
      if (!v) return;
      const download = () => void Linking.openURL(v.download_url);
      if (v.minimum && compare(installed, v.minimum) < 0) {
        Alert.alert(t('Update FarePay'), t('This version of FarePay no longer works. Download the new version to keep using it.'), [{ text: t('Download'), onPress: download }], {
          cancelable: false,
        });
      } else if (v.latest && compare(installed, v.latest) < 0 && !askedLater) {
        askedLater = true;
        Alert.alert(t('New version of FarePay'), t('Download it and install it over this one. You stay signed in.'), [
          { text: t('Later'), style: 'cancel' },
          { text: t('Download'), onPress: download },
        ]);
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void check());
    return () => sub.remove();
  }, []);
}
