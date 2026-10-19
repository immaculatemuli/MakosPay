// Booking a seat for later (today or tomorrow): the passenger says when they will be ready; the booking is offered to
// no car before then, joins the queue at that time (ahead of anyone who chose a later time), is free to cancel until
// then, and the passenger is reminded before. Marshals are told who joins their queue; drivers get pickups by SMS too.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SMS_PROVIDER = 'log';
// Booking is open all day in these tests; a booking for later can be ready from 00:00 to 23:29.
process.env.SEAT_BOOKING_CUTOFF = '23:59';
process.env.SEAT_BOOKING_OPENS = '00:00';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { refundUnboarded, runSeatTimers } = await import('../src/services/seats.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const login = async (phone, password) => (await api('POST', '/auth/login', { body: { phone, password } })).body.token;
const s = {};

async function passenger(name, phone) {
  const token = (await signUp(api, { name, phone, password: 'pass123' })).body.token;
  const userId = (await db.get('SELECT id FROM users WHERE phone = ?', `254${phone.slice(1)}`)).id;
  await tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 2000 }));
  return { token, userId };
}
const book = (who, body) =>
  api('POST', '/passenger/seats', {
    token: who.token,
    body: { route_id: s.route.id, stop_id: s.machakos.id, seats: 1, expected_fare: 400, idempotency_key: randomUUID(), pay_with: 'wallet', ...body },
  });
const balance = async (who) => (await db.get('SELECT balance FROM wallets WHERE user_id = ?', who.userId)).balance;
const queues = async () => (await api('GET', '/marshal/queues', { token: s.marshal })).body.routes.find((r) => r.id === s.route.id);
const seat = async (who, id) => (await api('GET', `/passenger/seats/${id}`, { token: who.token })).body;
const notes = async (token) => (await api('GET', '/notifications', { token })).body.items;

// Kenyan dates: tomorrow, and the day after.
const kenyaDate = (days) => new Date(Date.now() + 3 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const tomorrowAt = (hhmm) => `${kenyaDate(1)}T${hhmm}:00+03:00`;
// Moves a booking's time (as if the clock had moved on): its "ready from" and its place in the queue.
const setTime = (id, ms) => db.run('UPDATE seat_bookings SET ready_at = ?, queued_at = ? WHERE id = ?', new Date(ms).toISOString(), new Date(ms).toISOString(), id);

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Nairobi - Machakos', origin: 'Town', stops: [{ name: 'Juja', fare: 150 }, { name: 'Machakos', fare: 400 }] },
  })).body;
  [s.juja, s.machakos] = s.route.stops;
  const driver = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan Driver', phone: '0711000001', password: 'drive123' } })).body;
  s.car = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 111A', owner_name: 'Owner', owner_phone: '0744555666', route_id: s.route.id, seats: 14, driver_id: driver.id },
  })).body;
  s.driver = await login('0711000001', 'drive123');
  await api('POST', '/admin/marshals', { token: s.admin, body: { name: 'Mary Marshal', phone: '0722000009', password: 'marsh123' } });
  s.marshal = await login('0722000009', 'marsh123');
  s.p1 = await passenger('Pat One', '0733000001');
  s.p2 = await passenger('Pam Two', '0733000002');
  s.p3 = await passenger('Pete Three', '0733000003');
  s.p4 = await passenger('Paula Four', '0733000004');
});
after(() => server.close());

test('the booking screen is told which days and times can be chosen', async () => {
  const r = (await api('GET', '/passenger/seat-routes', { token: s.p1.token })).body;
  assert.deepEqual(r.later, { today: kenyaDate(0), tomorrow: kenyaDate(1), last_ready_at: '23:29' });
});

test('a seat booked for tomorrow is paid and held, but not in the queue and offered to no car', async () => {
  const r = await book(s.p1, { ready_at: tomorrowAt('10:00') });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'queued');
  assert.equal(r.body.later, true);
  assert.equal(Date.parse(r.body.ready_at), Date.parse(tomorrowAt('10:00')));
  assert.equal(r.body.place_in_queue, null);
  assert.equal(await balance(s.p1), 1600, '400 held');
  s.b1 = r.body.id;
  const told = (await notes(s.p1.token)).find((n) => n.kind === 'seat.queued');
  assert.match(told.title, /for tomorrow at 10:00/);

  const q = await queues();
  assert.deepEqual(q.stage_queue, []);
  assert.equal(q.seats_waiting, 0);
  assert.deepEqual(q.later.map((b) => b.id), [s.b1]);

  assert.equal((await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { vehicle_id: s.car.id } })).status, 200);
  assert.equal((await seat(s.p1, s.b1)).status, 'queued', 'the car at the stage does not take it');
  assert.equal((await notes(s.marshal)).filter((n) => n.kind === 'seat.new').length, 0, 'marshals are told when it joins the queue, not now');
});

test('only today or tomorrow, between opening and a little before the cutoff', async () => {
  assert.equal((await book(s.p2, { ready_at: `${kenyaDate(2)}T10:00:00+03:00` })).body.error.code, 'TOO_FAR_AHEAD');
  assert.equal((await book(s.p2, { ready_at: tomorrowAt('23:45') })).body.error.code, 'BAD_TIME');
  assert.equal((await book(s.p2, { ready_at: 'soon' })).body.error.code, 'BAD_TIME');
  assert.equal(await balance(s.p2), 2000, 'nothing taken');
  // A time a minute or two from now is the same as now.
  const now = await book(s.p2, { ready_at: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(now.body.later, false);
  assert.equal(now.body.status, 'assigned', 'the car at the stage takes it at once');
  s.b2now = now.body.id;
  // The marshals were told it joined the queue (and which car it went on).
  const told = (await notes(s.marshal)).find((n) => n.kind === 'seat.new');
  assert.match(told.body, /Put on KDA 111A/);
});

test('cancelling before the time is free: all the money back', async () => {
  const r = await book(s.p3, { ready_at: tomorrowAt('08:00') });
  assert.equal(await balance(s.p3), 1600);
  const c = await api('POST', `/passenger/seats/${r.body.id}/cancel`, { token: s.p3.token });
  assert.equal(c.body.status, 'cancelled');
  assert.equal(await balance(s.p3), 2000);
});

test('a road pickup booked for later cannot be given a car before its time', async () => {
  const r = await book(s.p4, { pickup_stop_id: s.juja.id, ready_at: tomorrowAt('09:00') });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  s.b4 = r.body.id;
  const load = await db.get("SELECT id FROM loads WHERE vehicle_id = ? AND status = 'loading'", s.car.id);
  const give = await api('POST', `/marshal/seats/${s.b4}/assign`, { token: s.marshal, body: { load_id: load.id } });
  assert.equal(give.body.error.code, 'NOT_YET');
  assert.deepEqual((await queues()).road_pickups, []);
});

test('the passenger is reminded shortly before their time, once', async () => {
  // Booked an hour ago for 20 minutes from now.
  await setTime(s.b1, Date.now() + 20 * 60_000);
  await db.run('UPDATE seat_bookings SET created_at = ? WHERE id = ?', new Date(Date.now() - 3600_000).toISOString(), s.b1);
  await runSeatTimers();
  await runSeatTimers();
  const reminders = (await notes(s.p1.token)).filter((n) => n.kind === 'seat.reminder');
  assert.equal(reminders.length, 1);
  assert.match(reminders[0].body, /Be at Town stage by \d\d:\d\d/);
  assert.equal((await seat(s.p1, s.b1)).status, 'queued', 'still waiting for its time');
});

test('when the time comes they join the queue, ahead of anyone who chose a later time; marshals are told', async () => {
  // Fill the car so nobody is put on it, and show the queue order.
  await db.run("UPDATE loads SET seats = 1 WHERE vehicle_id = ? AND status = 'loading'", s.car.id);
  const p3now = await book(s.p3, {});
  assert.equal(p3now.body.place_in_queue, 0);
  // Pat was ready 30 minutes ago, Paula's pickup 10 minutes ago: both are ahead of Pete, who booked just now.
  await setTime(s.b1, Date.now() - 30 * 60_000);
  await setTime(s.b4, Date.now() - 10 * 60_000);
  const before = (await notes(s.marshal)).filter((n) => n.kind === 'seat.new').length;
  const ran = await runSeatTimers();
  assert.equal(ran.joined, 2);
  const q = await queues();
  assert.deepEqual(q.stage_queue.map((b) => b.id), [s.b1, p3now.body.id]);
  assert.deepEqual(q.road_pickups.map((b) => b.id), [s.b4]);
  assert.deepEqual(q.later, []);
  assert.equal((await seat(s.p1, s.b1)).place_in_queue, 0);
  assert.ok((await notes(s.p1.token)).some((n) => n.kind === 'seat.in_queue' && /1st in the queue/.test(n.body)));
  const marshalNotes = (await notes(s.marshal)).filter((n) => n.kind === 'seat.new');
  assert.equal(marshalNotes.length - before, 2);
  await runSeatTimers();
  assert.equal((await notes(s.marshal)).filter((n) => n.kind === 'seat.new').length, marshalNotes.length, 'told once');
});

test("the driver gets a road pickup by SMS too", async () => {
  const load = await db.get("SELECT id FROM loads WHERE vehicle_id = ? AND status = 'loading'", s.car.id);
  await db.run('UPDATE loads SET seats = 14 WHERE id = ?', load.id);
  const give = await api('POST', `/marshal/seats/${s.b4}/assign`, { token: s.marshal, body: { load_id: load.id } });
  assert.equal(give.status, 200, JSON.stringify(give.body));
  const sms = await db.get("SELECT * FROM sms_outbox WHERE phone = '254711000001' AND kind = 'seat.pickup'");
  assert.match(sms.message, /pick 1 seat at Juja for KDA 111A: Paula Four/);
  assert.ok((await notes(s.driver)).some((n) => n.kind === 'seat.pickup'), 'and in the app');
});

test("the night's refunds leave tomorrow's bookings alone", async () => {
  const r = await book(s.p2, { ready_at: tomorrowAt('07:00') });
  const refunded = await refundUnboarded();
  assert.ok(refunded >= 1);
  assert.equal((await seat(s.p2, r.body.id)).status, 'queued', "tomorrow's booking is kept");
  assert.equal((await seat(s.p2, r.body.id)).later, true);
});
