// Less typing at the stage: the marshal scans a car's sticker when it arrives, and the marshal or crew scan the QR on
// the passenger's booking screen to tick them on board.
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
  const token = (await signUp(api, { name, phone, password: 'pass123' })).body.token;
  const userId = (await db.get('SELECT id FROM users WHERE phone = ?', `254${phone.slice(1)}`)).id;
  await tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 2000 }));
  return token;
}
const book = async (token, seats = 1) =>
  (await api('POST', '/passenger/seats', {
    token,
    body: { route_id: s.route.id, stop_id: s.stop.id, seats, expected_fare: 200, idempotency_key: randomUUID(), pay_with: 'wallet' },
  })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Machakos', stops: [{ name: 'Nairobi', fare: 200 }] } })).body;
  s.stop = s.route.stops[0];
  const conductor = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711000001', password: 'crew123' } })).body;
  const car = (plate, extra = {}) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id, seats: 14, ...extra } }).then((r) => r.body);
  s.carA = await car('KDA 123A', { conductor_id: conductor.id });
  s.carB = await car('KDB 123S');
  s.conductor = await login('0711000001', 'crew123');
  await api('POST', '/admin/marshals', { token: s.admin, body: { name: 'Mary Marshal', phone: '0722000009', password: 'marsh123' } });
  s.marshal = await login('0722000009', 'marsh123');
  s.pat = await passenger('Pat One', '0733000001');
  s.pam = await passenger('Pam Two', '0733000002');
});
after(() => server.close());

test('a booking waiting in the queue cannot board yet', async () => {
  s.patBooking = await book(s.pat, 2);
  const res = await api('POST', '/marshal/seats/board-code', { token: s.marshal, body: { code: s.patBooking.code } });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /Pat One .* is still waiting in the queue/);
});

test('the marshal scans the sticker of the car that arrived: it loads and takes the queue', async () => {
  const wrong = await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { qr: 'not-a-car', route_id: s.route.id } });
  assert.equal(wrong.status, 404);
  const res = await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { qr: s.carA.qr_token, route_id: s.route.id } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const mine = (await api('GET', `/passenger/seats/${s.patBooking.id}`, { token: s.pat })).body;
  assert.equal(mine.status, 'assigned');
  assert.equal(mine.car.plate, 'KDA 123A');
});

test("the crew can only board passengers put on their own car", async () => {
  await api('POST', '/marshal/cars/arrived', { token: s.marshal, body: { vehicle_id: s.carB.id, route_id: s.route.id } });
  s.pamBooking = await book(s.pam);
  const onB = (await api('GET', `/passenger/seats/${s.pamBooking.id}`, { token: s.pam })).body;
  assert.equal(onB.car.plate, 'KDA 123A', 'still seats on the first car');
  // Send Pam's booking to car B to check the crew rule.
  await db.run('UPDATE seat_bookings SET load_id = (SELECT id FROM loads WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1) WHERE id = ?', s.carB.id, s.pamBooking.id);
  const other = await api('POST', '/crew/seats/board-code', { token: s.conductor, body: { code: s.pamBooking.code } });
  assert.equal(other.status, 409);
  assert.match(other.body.error.message, /Pam Two .* is booked on KDB 123S, not this car/);
});

test("scanning the passenger's QR ticks them on board and says who it is; twice is harmless", async () => {
  const res = await api('POST', '/crew/seats/board-code', { token: s.conductor, body: { code: `FAREPAY-SEAT:${s.patBooking.code.toLowerCase()}` } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { code: s.patBooking.code, passenger_name: 'Pat One', seats: 2, stop_name: 'Nairobi', plate: 'KDA 123A', already_boarded: false });
  assert.equal((await api('GET', `/passenger/seats/${s.patBooking.id}`, { token: s.pat })).body.status, 'boarded');
  const again = await api('POST', '/marshal/seats/board-code', { token: s.marshal, body: { code: s.patBooking.code } });
  assert.equal(again.status, 200);
  assert.equal(again.body.already_boarded, true);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM trips WHERE ticket_code IS NOT NULL AND passenger_id = (SELECT id FROM users WHERE phone = '254733000001')")).n, 1, 'one fare, not two');
});

test('unknown codes and other roles are refused', async () => {
  assert.equal((await api('POST', '/marshal/seats/board-code', { token: s.marshal, body: { code: 'ZZZZZZ' } })).status, 404);
  assert.equal((await api('POST', '/marshal/seats/board-code', { token: s.pat, body: { code: s.patBooking.code } })).status, 403);
});
