import { File, Paths } from 'expo-file-system';
import type { Trip } from './types';

// The passenger's latest tickets, kept on the phone so they open without internet (signal in a matatu is patchy),
// even from the sign-in screen. One file per phone number; removed on sign-out so the next person doesn't see them.
const KEEP = 20;
const fileFor = (phone: string) => new File(Paths.document, `tickets-${phone.replace(/\D/g, '')}.json`);

// Whose tickets are saved: the signed-in passenger (set by auth).
let owner: string | null = null;
export const setTicketOwner = (phone: string | null) => {
  owner = phone;
};

export async function loadSavedTickets(phone: string | null = owner): Promise<Trip[]> {
  if (!phone) return [];
  try {
    const file = fileFor(phone);
    return file.exists ? (JSON.parse(await file.text()) as Trip[]) : [];
  } catch {
    return [];
  }
}

/** Keeps these tickets together with those already saved: the latest KEEP of them, newest first. */
export async function saveTickets(trips: Trip[]) {
  const phone = owner;
  if (!phone || !trips.length) return;
  try {
    const byId = new Map((await loadSavedTickets(phone)).map((t) => [t.id, t]));
    for (const t of trips) byId.set(t.id, t);
    const latest = [...byId.values()].sort((a, b) => b.id - a.id).slice(0, KEEP);
    fileFor(phone).write(JSON.stringify(latest));
  } catch {
    // Only a convenience: the tickets are still on the server.
  }
}

/** Signing out: the tickets of whoever was signed in are removed from this phone. */
export function forgetSavedTickets(phone: string | null = owner) {
  if (!phone) return;
  try {
    const file = fileFor(phone);
    if (file.exists) file.delete();
  } catch {
    // Nothing saved, or already gone.
  }
}
