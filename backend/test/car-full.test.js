// A loading car is never over-promised: passengers who walk up and pay FarePay take seats too, and the marshal or
// crew can say the car is full (cash passengers filled it) so the queue goes to the next car.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SEAT_BOOKING_CUTOFF = '23:59';
process.env.SEAT_BOOKING_OPENS = '00:00';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');

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
  const token = (await signUp(api, { name, phone, password: 'Apass123' })).body.token;
  const userId = (await db.get('SELECT id FROM users WHERE phone = ?', `254${phone.slice(1)}`)).id;
  await tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 5000 }));
  return token;
}
const book = async (token) =>
  (await api('POST', '/passenger/seats', {
    token,
    body: { route_id: s.route.id, stop_id: s.stop.id, seats: 1, expected_fare: 200, idempotency_key: randomUUID(), pay_with: 'wallet' },
  })).body;
const walkIn = (token, car) =>
  api('POST', '/passenger/pay', { token, body: { qr: car.qr_token, stop_id: s.stop.id, expected_fare: 200, idempotency_key: randomUUID() } });
const carRow = async (car) => (await api('GET', '/marshal/queues', { token: s.marshal })).body.routes.find((r) => r.id === s.route.id).cars.find((c) => c.vehicle_id === car.id);
const status = async (token, id) => (await api('GET', `/passenger/seats/${id}`, { token })).body.status;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Machakos', stops: [{ name: 'Nairobi', fare: 200 }] } })).body;
  s.stop = s.route.stops[0];
  const conductor = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711000001', password: 'Acrew123' } })).body;
  const car = (plate, seats, extra = {}) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id, seats, ...extra } }).then((r) => r.body);
  s.small = await car('KDA 123A', 3, { conductor_id: conductor.id });
  s.big = await car('KDB 123S', 14);
  s.conductor = await login('0711000001', 'Acrew123');
  await api('POST', '/admin/marshals', { token: s.admin, body: { name: 'Mary Marshal', phone: '0722000009', password: 'Amarsh123' } });
  s.marshal = await login('0722000009', 'Amarsh123');
  s.pat = await passenger('Pat', '0733000001');
  s.walkers = await passenger('Walk In', '0733000002');
});
after(() => server.close());

test('passengers who walk up and pay take seats: the queue is not sent to a car that is full', async () => {
  await walkIn(s.walkers, s.small); // paid before the car started loading: not counted
  await api('POST', '/crew/loading/start', { token: s.conductor });
  await walkIn(s.walkers, s.small);
  await walkIn(s.walkers, s.small);
  assert.equal((await carRow(s.small)).seats_left, 1, '3 seats, 2 walk-ins while loading');
  const first = await book(s.pat);
  assert.equal(await status(s.pat, first.id), 'assigned', 'the last seat');
  assert.equal((await carRow(s.small)).seats_left, 0);
  const second = await book(s.pat);
  assert.equal(await status(s.pat, second.id), 'queued', 'no seat left: waits for the next car');
  const crew = (await api('GET', '/crew/loading', { token: s.conductor })).body;
  assert.deepEqual([crew.loading.seats_booked, crew.loading.seats_left, crew.loading.full], [3, 0, false]);
  s.waiting = second.id;
  await api('POST', '/crew/loading/depart', { token: s.conductor });
});

test('a car marked full takes nobody from the queue; marked not full, it takes the next', async () => {
  await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { vehicle_id: s.big.id, route_id: s.route.id } });
  assert.equal(await status(s.pat, s.waiting), 'assigned', 'the waiting passenger goes on the big car');

  const full = await api('POST', `/marshal/cars/${s.big.id}/full`, { token: s.marshal, body: { full: true } });
  assert.equal(full.status, 200);
  assert.deepEqual([(await carRow(s.big)).full, (await carRow(s.big)).seats_left], [true, 0]);
  const late = await book(s.pat);
  assert.equal(await status(s.pat, late.id), 'queued', 'cash passengers filled it');

  await api('POST', `/marshal/cars/${s.big.id}/full`, { token: s.marshal, body: { full: false } });
  assert.equal(await status(s.pat, late.id), 'assigned', 'taken from the queue at once');
  assert.equal((await carRow(s.big)).full, false);
});

test('the crew can mark their own loading car full; a car not loading is refused', async () => {
  const notLoading = await api('POST', '/crew/loading/full', { token: s.conductor, body: { full: true } });
  assert.equal(notLoading.status, 409);
  await api('POST', '/crew/loading/start', { token: s.conductor });
  const res = await api('POST', '/crew/loading/full', { token: s.conductor, body: { full: true } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.loading.full, res.body.loading.seats_left], [true, 0]);
});
