import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { api } from './api';

export type Sharing = 'off' | 'asking' | 'sharing' | 'denied';

/**
 * While `active` (the car is on a trip), sends the car's position from this phone to FarePay about every 15 seconds
 * or 30 metres, for the passengers it is picking and the marshal. Stops as soon as the trip is over.
 * (Expo Go sends only while the app is open; the installed app is needed to send with the screen off.)
 */
export function useShareCarLocation(active: boolean): Sharing {
  const [state, setState] = useState<Sharing>('off');
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let stopped = false;
    (async () => {
      setState('asking');
      const { status } = await Location.requestForegroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
      if (stopped) return;
      if (status !== 'granted') return setState('denied');
      setState('sharing');
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 15_000, distanceInterval: 30 }, (p) => {
        const { latitude: lat, longitude: lng, heading, speed, accuracy } = p.coords;
        api('/crew/location', { method: 'POST', body: { lat, lng, heading, speed, accuracy } }).catch(() => {
          // Offline for a moment: the next position will go.
        });
      }).catch(() => null);
      if (stopped) sub?.remove();
    })();
    return () => {
      stopped = true;
      sub?.remove();
      setState('off');
    };
  }, [active]);
  return state;
}
