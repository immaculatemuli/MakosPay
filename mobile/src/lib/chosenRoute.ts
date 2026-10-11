import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

const KEY = 'farepay.chosenStop';

/** Where the passenger said they are going: a route and the stop where they will get off. */
export interface ChosenStop {
  route_id: number;
  route_name: string;
  stop_id: number;
  stop_name: string;
}

/** Remembers the passenger's route and drop-off on this phone. */
export async function saveChosenStop(choice: ChosenStop) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(choice));
}

/** The chosen route and drop-off, re-read whenever the screen comes into focus. `undefined` while loading. */
export function useChosenStop() {
  const [choice, setChoice] = useState<ChosenStop | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      SecureStore.getItemAsync(KEY)
        .then((raw) => {
          const parsed = raw ? JSON.parse(raw) : null;
          setChoice(parsed?.stop_id ? parsed : null); // ignore the older route-only format
        })
        .catch(() => setChoice(null));
    }, []),
  );
  return choice;
}
