import { dayTime, kes } from './format';
import { t } from './i18n';
import type { SeatBooking } from './types';

// What a seat booking is doing, in the passenger's words: the booking screen's title and line, and the card at the top
// of the passenger's home screen while a booking is open.

export const SEAT_TITLE: Record<SeatBooking['status'], string> = {
  paying: 'Waiting for M-Pesa…',
  queued: 'Seat booked',
  assigned: 'Your car is coming',
  boarded: 'On board',
  cancelled: 'Cancelled',
  failed: 'Not paid',
};

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** The booking screen's title: "You’ve arrived" once the car reaches the drop-off. */
export const seatTitle = (b: SeatBooking) => (b.status === 'boarded' && b.car?.reached_my_stop ? 'You’ve arrived' : SEAT_TITLE[b.status]);

/** What to tell the passenger now: pay, their place in the queue, which car to board, or what happened. */
export function seatLine(b: SeatBooking) {
  if (b.status === 'paying') return t('Enter your M-Pesa PIN on your phone to finish booking.');
  if (b.status === 'failed') return `${b.reason || t('M-Pesa did not complete the payment')}. ${t('No money was taken.')}`;
  if (b.status === 'cancelled') {
    const where = b.refund_to === 'wallet' ? t('{amount} is back in your FarePay wallet.', { amount: kes(b.amount) }) : t('{amount} is being sent back to your M-Pesa.', { amount: kes(b.amount) });
    return `${b.reason ? `${b.reason}. ` : ''}${where}`;
  }
  if (b.status === 'boarded' && b.car?.reached_my_stop) return t('You’ve reached {stop}. Thank you for travelling with us.', { stop: b.stop_name });
  if (b.status === 'boarded') return t('You’re on board {plate}. Have a good trip to {stop}.', { plate: b.car?.plate ?? '', stop: b.stop_name });
  if (b.status === 'assigned' && b.car) {
    if (b.pickup.at_stage) return t('Board {plate} now at {place}. Show this code when you get on.', { plate: b.car.plate, place: b.pickup.name });
    if (b.car.status === 'departed') return t('{plate} has left {origin} and is coming to pick you at {place}. Be ready with this code.', { plate: b.car.plate, origin: b.route.origin, place: b.pickup.name });
    return t('{plate} will pick you at {place}. We’ll tell you when it leaves {origin}.', { plate: b.car.plate, place: b.pickup.name, origin: b.route.origin });
  }
  if (b.later && b.ready_at) {
    return t('Booked for {when}. Be at {place} by then: you join the queue at that time and we’ll tell you which car. You can cancel free until then.', { when: dayTime(b.ready_at), place: b.pickup.name });
  }
  if (b.pickup.at_stage) {
    return b.place_in_queue === 0
      ? t('You’re next in the queue at {place}. The next car to arrive is yours.', { place: b.pickup.name })
      : t('You’re {nth} in the queue at {place}. We’ll tell you which car to board.', { nth: ordinal((b.place_in_queue ?? 0) + 1), place: b.pickup.name });
  }
  return t('Wait at {place}. We’ll tell you which car is coming for you.', { place: b.pickup.name });
}
