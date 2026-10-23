// Loyalty: a passenger's every 50th paid ride is free. Paid rides (fares and boarded seat bookings, not refunded)
// from the last 90 days count, starting again after each free ride. The free ride is the whole fare, applied on its
// own. The car's owner is still paid in full: the SACCO covers it, as a `free_ride` credit to the passenger's wallet
// that the fare then uses, so every shilling still adds up (and the SACCO's cost is in the money check).
import { config } from '../config.js';
import { db } from '../database.js';
import { kesText, notify } from './notifications.js';
import { postWalletEntry } from './wallet.js';

/** Where the passenger stands: paid rides counted so far, how many earn a free one, and whether the next is free. */
export async function freeRideProgress(passengerId) {
  const every = config.freeRideEvery;
  const since = new Date(Date.now() - config.freeRideWindowDays * 86_400_000).toISOString();
  // Counting starts again after the last free ride that was used (a refunded free ride gives it back).
  const lastFree = await db.get(
    "SELECT MAX(created_at) AS at FROM trips WHERE passenger_id = ? AND free_ride = TRUE AND status = 'paid'",
    passengerId,
  );
  const from = lastFree?.at && lastFree.at > since ? lastFree.at : since;
  const rides = (
    await db.get(
      "SELECT COUNT(*) AS n FROM trips WHERE passenger_id = ? AND status = 'paid' AND free_ride = FALSE AND created_at > ?",
      passengerId,
      from,
    )
  ).n;
  // A free seat booking waiting to be boarded is the free ride already given.
  const waiting = await db.get(
    "SELECT 1 FROM seat_bookings WHERE passenger_id = ? AND free_ride = TRUE AND status IN ('queued', 'assigned')",
    passengerId,
  );
  const needed = every - 1;
  return { every, rides: Math.min(rides, needed), needed, next_is_free: rides >= needed && !waiting, window_days: config.freeRideWindowDays };
}

export const nextRideIsFree = async (passengerId) => config.freeRideEvery > 0 && (await freeRideProgress(passengerId)).next_is_free;

/** The SACCO pays this ride for the passenger (inside the fare's transaction, before the fare is taken). */
export function creditFreeRide(passengerId, amount, reference) {
  return postWalletEntry(passengerId, {
    type: 'free_ride',
    amount,
    reference,
    description: `Free ride: your ${config.freeRideEvery}th ride is on ${config.saccoName}`,
  });
}

/** Takes back a free ride's credit (it was refunded or cancelled); the passenger's next ride is free instead. */
export function reverseFreeRide(passengerId, amount, reference) {
  return postWalletEntry(passengerId, {
    type: 'free_ride_reversal',
    amount: -amount,
    reference,
    description: 'Free ride not used: your next ride is free instead',
  });
}

/** After a paid ride: tell the passenger when their next ride will be free. */
export async function afterPaidRide(passengerId) {
  if (config.freeRideEvery <= 0) return;
  const p = await freeRideProgress(passengerId);
  if (p.next_is_free && p.rides === p.needed) {
    await notify([passengerId], {
      kind: 'reward.ready',
      title: 'Your next ride is free',
      body: `Thank you for riding with us: ${p.needed} paid rides. Your next fare is on ${config.saccoName}.`,
      target: 'trips',
    });
  }
}

/** Tells the passenger a ride was free. */
export const notifyFreeRide = (passengerId, fare) =>
  notify([passengerId], { kind: 'reward.used', title: 'This ride was free', body: `${kesText(fare)} paid by ${config.saccoName}. Thank you for riding with us!`, target: 'trips' });
