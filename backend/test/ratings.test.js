// Passengers rate their trips (1–5 stars, optional comment); only the office sees ratings, and is told of low ones.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

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
  await tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 1000 }));
  return { token, userId };
}
const pay = async (who) =>
  (await api('POST', '/passenger/pay', { token: who.token, body: { qr: s.car.qr_token, stop_id: s.stop.id, expected_fare: 100, idempotency_key: randomUUID() } })).body.trip;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Town - Juja', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 120, app_fare: 100 }] } })).body;
  s.stop = route.stops[0];
  const driver = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan Driver', phone: '0711000001', password: 'Adrive123' } })).body;
  s.car = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 111A', owner_name: 'Owner', owner_phone: '0744555666', route_id: route.id, seats: 14, driver_id: driver.id } })).body;
  s.p1 = await passenger('Pat One', '0733000001');
  s.p2 = await passenger('Pam Two', '0733000002');
  s.driver = await login('0711000001', 'Adrive123');
});
after(() => server.close());

test('a passenger rates their trip, can change it, and sees it on their trips', async () => {
  const trip = await pay(s.p1);
  s.trip = trip;
  const r = await api('POST', `/passenger/trips/${trip.id}/rating`, { token: s.p1.token, body: { stars: 4, comment: 'Clean car' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { stars: 4, comment: 'Clean car' });
  await api('POST', `/passenger/trips/${trip.id}/rating`, { token: s.p1.token, body: { stars: 5 } });
  const trips = (await api('GET', '/passenger/trips', { token: s.p1.token })).body.items;
  assert.equal(trips[0].my_rating, 5);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM trip_ratings')).n, 1, 'one rating per trip');
});

test("nobody rates someone else's trip, and stars are 1 to 5", async () => {
  assert.equal((await api('POST', `/passenger/trips/${s.trip.id}/rating`, { token: s.p2.token, body: { stars: 1 } })).status, 404);
  assert.equal((await api('POST', `/passenger/trips/${s.trip.id}/rating`, { token: s.p1.token, body: { stars: 6 } })).status, 400);
  assert.equal((await api('POST', `/passenger/trips/${s.trip.id}/rating`, { token: s.p1.token, body: { stars: 0 } })).status, 400);
});

test('a low rating tells the office; only the office sees ratings, with averages per car and driver', async () => {
  const trip = await pay(s.p2);
  await api('POST', `/passenger/trips/${trip.id}/rating`, { token: s.p2.token, body: { stars: 2, comment: 'Loud music' } });
  const notes = (await api('GET', '/notifications', { token: s.admin })).body.items;
  assert.ok(notes.some((n) => n.kind === 'rating.low' && n.title === '2 stars for KDA 111A' && n.body.includes('Loud music')));

  const r = (await api('GET', '/admin/ratings', { token: s.admin })).body;
  assert.equal(r.ratings.length, 2);
  assert.equal(r.ratings[0].driver_name, 'Dan Driver');
  assert.deepEqual(r.by_vehicle.map((v) => [v.name, v.average, v.count]), [['KDA 111A', 3.5, 2]]);
  assert.deepEqual(r.by_driver.map((d) => [d.name, d.average]), [['Dan Driver', 3.5]]);
  assert.equal((await api('GET', '/admin/ratings?low=1', { token: s.admin })).body.ratings.length, 1);

  assert.equal((await api('GET', '/admin/ratings', { token: s.driver })).status, 403, 'not the crew');
  assert.equal((await api('GET', '/admin/ratings', { token: s.p1.token })).status, 403, 'not passengers');
});
