// USSD: passengers without the app or a smartphone dial the SACCO's code (through Africa's Talking) to pay a fare in
// the car or book a seat from anywhere. Each key press sends everything typed so far ("1*214*2"); the answer is the
// next screen ("CON ...", waiting for input) or the last one ("END ..."). Money comes off their M-Pesa by the usual
// PIN prompt, priced by the server from the fare table, exactly like the app and the QR pay page.
//
// A phone can't show the M-Pesa prompt while a USSD screen is open, so the session ends first and the prompt is
// sent a moment later. If it can't be (e.g. the fare changed in between), the passenger gets an SMS saying why.
import { config } from '../config.js';
import { db } from '../database.js';
import { passengerFor } from './noapp.js';
import { kesText } from './notifications.js';
import { smsTicket, startFarePayment } from './payments.js';
import { listRoutes } from './routes.js';
import { bookingClosed, bookSeats, MAX_SEATS } from './seats.js';
import { queueSms } from './sms.js';
import { loadVehicle } from './trips.js';

// A USSD screen holds about 182 characters; lists longer than that go on several pages ("0. More").
const SCREEN = 182;
const MAX_ITEMS = 7;
const con = (text) => `CON ${text}`;
const end = (text) => `END ${text}`;
const seatWord = (n) => `${n} seat${n === 1 ? '' : 's'}`;

// Prompts sent after the session ended, so tests (and a shutdown) can wait for them.
const pending = new Set();
export const ussdIdle = () => Promise.allSettled([...pending]);

function later(phone, work) {
  const job = new Promise((resolve) => setTimeout(resolve, config.ussd.promptDelayMs))
    .then(work)
    .catch((err) => queueSms(phone, 'ussd_failed', `${config.saccoName}: your payment was not started. ${err.message}`))
    .catch((err) => console.error('[ussd] could not tell the passenger', err))
    .finally(() => pending.delete(job));
  pending.add(job);
}

/**
 * One page of a numbered list, as many items as fit. Numbers run on across pages (page 2 starts at 8), so a
 * number always means the same item.
 */
function pageOf(items, start, header) {
  const lines = [];
  let length = header.length + 12; // + "0. More"
  for (let i = start; i < items.length && lines.length < MAX_ITEMS; i++) {
    const line = `${i + 1}. ${items[i]}`;
    if (lines.length > 0 && length + line.length + 1 > SCREEN) break;
    lines.push(line);
    length += line.length + 1;
  }
  return { lines, next: start + lines.length };
}

/**
 * Reads a choice from a list at tokens[pos]: "0" turns the page. Returns { index, pos } once chosen, or { screen } to
 * show (the list, or an END for a wrong number).
 */
function choose(tokens, pos, labels, header) {
  let start = 0;
  for (;;) {
    const { lines, next } = pageOf(labels, start, header);
    const more = next < labels.length;
    const typed = tokens[pos];
    if (typed === undefined) return { screen: con([header, ...lines, ...(more ? ['0. More'] : [])].join('\n')) };
    if (typed === '0' && more) {
      start = next;
      pos++;
      continue;
    }
    const n = Number(typed);
    if (Number.isInteger(n) && n > start && n <= next) return { index: n - 1, pos: pos + 1 };
    return { screen: end('That is not one of the choices. Please dial again.') };
  }
}

/** The next screen for what the passenger has typed so far. Never throws: problems become an END screen. */
export async function ussdReply({ sessionId, phone, text }) {
  try {
    const tokens = text ? String(text).split('*') : [];
    if (tokens.length === 0) return con(`${config.saccoName}\n1. Pay fare\n2. Book a seat`);
    if (tokens[0] === '1') return await payFare(tokens, { sessionId, phone });
    if (tokens[0] === '2') return await bookSeat(tokens, { sessionId, phone });
    return end('That is not one of the choices. Please dial again.');
  } catch (err) {
    // Expected problems (no route, staff number, ...) carry a message for the passenger.
    if (err.status && err.status < 500) return end(err.message);
    console.error('[ussd]', err);
    return end('Something went wrong. Please try again in a moment.');
  }
}

// ---------- 1. Pay fare (in the car) ----------

async function payFare(tokens, { sessionId, phone }) {
  const typed = tokens[1];
  if (typed === undefined) return con('Enter the car number on the sticker in the car (e.g. 214):');
  const carNumber = Number(typed);
  const car = Number.isInteger(carNumber) ? await db.get('SELECT qr_token, plate, car_number, is_active FROM vehicles WHERE car_number = ?', carNumber) : null;
  if (!car || !car.is_active) return end(`Car ${typed} was not found. Check the number on the sticker and dial again.`);
  const { route } = await loadVehicle(car.qr_token); // also applies a fare change due today
  const carName = `Car ${car.car_number} (${car.plate})`;

  const drop = choose(
    tokens,
    2,
    route.stops.map((s) => `${s.name} ${kesText(s.app_fare)}`),
    `${carName}\nWhere do you get off?`,
  );
  if (drop.screen) return drop.screen;
  const stop = route.stops[drop.index];

  const answer = tokens[drop.pos];
  if (answer === undefined) return con(`Pay ${kesText(stop.app_fare)} to ${stop.name}, ${carName}?\n1. Pay with M-Pesa\n2. Cancel`);
  if (answer !== '1') return end('Cancelled. Nothing was paid.');

  await passengerFor(phone); // a staff number can't pay: say so now, on the screen
  later(phone, async () => {
    const userId = await passengerFor(phone);
    const started = await startFarePayment(userId, {
      qr: car.qr_token,
      stopId: stop.id,
      expectedFare: stop.app_fare,
      idempotencyKey: `ussd-${sessionId}`,
      phone,
      channel: 'ussd',
    });
    if (started.trip) await smsTicket(phone, started.trip.id); // a free ride: paid at once, no prompt
  });
  return end(`An M-Pesa prompt for ${kesText(stop.app_fare)} is coming now. Enter your PIN. Your ticket will come by SMS.`);
}

// ---------- 2. Book a seat (from anywhere) ----------

async function bookSeat(tokens, { sessionId, phone }) {
  if (bookingClosed()) return end(`Seat booking is closed for today. It opens again at ${config.seatBookingOpens}.`);
  const routes = (await listRoutes({ activeOnly: true })).filter((r) => r.stops.length > 0);
  if (routes.length === 0) return end('No routes are open for booking yet.');

  const r = choose(tokens, 1, routes.map((x) => x.name), 'Choose your route:');
  if (r.screen) return r.screen;
  const route = routes[r.index];

  const d = choose(tokens, r.pos, route.stops.map((s) => `${s.name} ${kesText(s.app_fare)}`), 'Where do you get off?');
  if (d.screen) return d.screen;
  const stop = route.stops[d.index];

  // At the stage, or picked on the road at a stop before the drop-off (same full fare from the stage).
  const before = route.stops.filter((s) => s.position < stop.position);
  let pos = d.pos;
  let pickup = null;
  if (before.length > 0) {
    const where = tokens[pos];
    if (where === undefined) return con(`Where will you board?\n1. At ${route.origin} stage\n2. On the road, before ${stop.name}`);
    pos++;
    if (where === '2') {
      const p = choose(tokens, pos, before.map((s) => s.name), 'Where should the car pick you?');
      if (p.screen) return p.screen;
      pickup = before[p.index];
      pos = p.pos;
    } else if (where !== '1') {
      return end('That is not one of the choices. Please dial again.');
    }
  }

  const typedSeats = tokens[pos];
  if (typedSeats === undefined) return con(`How many seats? (1-${MAX_SEATS})`);
  const seats = Number(typedSeats);
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) return end(`Book 1 to ${MAX_SEATS} seats. Please dial again.`);
  pos++;

  const total = stop.app_fare * seats;
  const from = pickup ? `pick-up at ${pickup.name}` : `at ${route.origin} stage`;
  const answer = tokens[pos];
  if (answer === undefined) return con(`Book ${seatWord(seats)} to ${stop.name}, ${from}: ${kesText(total)}?\n1. Pay with M-Pesa\n2. Cancel`);
  if (answer !== '1') return end('Cancelled. Nothing was paid.');

  await passengerFor(phone);
  later(phone, async () => {
    await bookSeats({
      passengerId: await passengerFor(phone),
      phone,
      routeId: route.id,
      pickupStopId: pickup?.id ?? null,
      stopId: stop.id,
      seats,
      expectedFare: stop.app_fare,
      idempotencyKey: `ussd-${sessionId}`,
      payWith: 'mpesa',
    });
  });
  return end(`An M-Pesa prompt for ${kesText(total)} is coming now. Enter your PIN. Your booking code will come by SMS.`);
}
