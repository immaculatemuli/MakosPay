// The conductor's live payment feed: a quick "anything new?" check every few seconds, and the money on the current trip.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

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
const s = {};
const pay = async (stop) =>
  (await api('POST', '/passenger/pay', {
    token: s.passenger,
    body: { qr: s.vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() },
  })).body.trip;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Machakos Road', origin: 'Machakos', stops: [{ name: 'Athi River', fare: 60 }, { name: 'Nairobi', fare: 100 }] },
  })).body;
  const ian = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'cond123' } })).body;
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', owner_name: 'Mary Owner', owner_phone: '0744555666', conductor_id: ian.id, route_id: s.route.id },
  })).body;
  s.conductor = (await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } })).body.token;
  s.passenger = (await signUp(api, { name: 'Pat Passenger', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
});
after(() => server.close());

test('the quick check says nothing new until someone pays, then names the newest payment', async () => {
  const empty = await api('GET', '/crew/payments/latest', { token: s.conductor });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { latest_id: 0, refunded: 0 });

  const trip = await pay(s.route.stops[1]);
  const latest = (await api('GET', '/crew/payments/latest', { token: s.conductor })).body;
  assert.deepEqual(latest, { latest_id: trip.id, refunded: 0 });

  // The full list has what the alert shows: amount, partly hidden phone, drop-off.
  const day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.deepEqual([day.payments[0].id, day.payments[0].fare, day.payments[0].passenger_phone, day.payments[0].stop_name], [trip.id, 100, '0722***444', 'Nairobi']);
});

test('a refund changes the quick check, so the list on the phone updates', async () => {
  const trip = await pay(s.route.stops[0]);
  await api('POST', `/admin/payments/${trip.id}/refund`, { token: s.admin, body: { reason: 'Wrong car' } });
  const latest = (await api('GET', '/crew/payments/latest', { token: s.conductor })).body;
  assert.deepEqual(latest, { latest_id: trip.id, refunded: 1 });
});

test('no trip yet today: no trip total', async () => {
  const day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.equal(day.trip, null);
});

test('the trip total counts what was paid from loading at the stage until the trip finished', async () => {
  await api('POST', '/crew/loading/start', { token: s.conductor });
  await pay(s.route.stops[1]);
  await pay(s.route.stops[0]);
  let day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.equal(day.trip.route_name, 'Machakos Road');
  assert.equal(day.trip.finished_at, null);
  assert.deepEqual([day.trip.payments, day.trip.total], [2, 160], 'only this trip: earlier payments today are not in it');
  assert.deepEqual([day.summary.payments, day.summary.total], [3, 260], 'the day total keeps everything (not the refund)');

  await api('POST', '/crew/loading/depart', { token: s.conductor });
  await pay(s.route.stops[1]); // paid on the road
  await api('POST', '/crew/road/finish', { token: s.conductor });
  day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.ok(day.trip.finished_at);
  assert.deepEqual([day.trip.payments, day.trip.total], [3, 260]);

  await pay(s.route.stops[0]); // after the trip finished: not in it
  day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.deepEqual([day.trip.payments, day.trip.total], [3, 260]);
});

test('another day: no trip total, and only crew can look', async () => {
  const yesterday = new Date(Date.now() + 3 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  const old = (await api('GET', `/crew/payments?date=${yesterday}`, { token: s.conductor })).body;
  assert.equal(old.trip, null);
  assert.equal((await api('GET', '/crew/payments/latest', { token: s.passenger })).status, 403);
});
