import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

/**
 * Keeps the phone's screen on while `active` and this screen is showing. The app can only ring for payments and
 * send the car's position while it is open with the screen on (until push and background location come with the
 * installed app), so the crew's phone must not go to sleep during a trip.
 */
export function useKeepAwakeWhile(active: boolean, tag: string) {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      activateKeepAwakeAsync(tag).catch(() => {});
      return () => {
        deactivateKeepAwake(tag).catch(() => {});
      };
    }, [active, tag]),
  );
}
