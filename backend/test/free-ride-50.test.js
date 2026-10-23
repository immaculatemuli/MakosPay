// Loyalty with the real numbers: 49 paid rides, then the 50th is free; then 49 more and the 100th is free.
// The owner is paid every fare in full and the money check adds up.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
delete process.env.FREE_RIDE_EVERY; // the real setting: every 50th ride

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
const balance = async () => (await db.get('SELECT balance FROM wallets WHERE user_id = ?', s.userId)).balance;
const ride = (how = 'pay') =>
  api('POST', `/passenger/${how}`, { token: s.token, body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: 100, idempotency_key: randomUUID() } });
const progress = async () => (await api('GET', '/passenger/summary', { token: s.token })).body.free_ride;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', fare: 100 }] } })).body;
  s.stop = s.route.stops[0];
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id } })).body;
  s.token = (await signUp(api, { name: 'Pat', phone: '0722000001', password: 'pass123' })).body.token;
  s.userId = (await db.get("SELECT id FROM users WHERE phone = '254722000001'")).id;
  await tx(() => postWalletEntry(s.userId, { type: 'test_credit', amount: 10_000 }));
});
after(() => server.close());

/** 49 paid rides (wallet, with some by M-Pesa if asked: fewer than its PIN-prompt limit), checking the count shown to the passenger on the way. */
async function fortyNinePaidRides({ someByMpesa = false } = {}) {
  for (let i = 1; i <= 49; i++) {
    const r = await ride(someByMpesa && i % 7 === 0 ? 'pay-mpesa' : 'pay');
    assert.ok([201, 202].includes(r.status), `ride ${i}: ${JSON.stringify(r.body)}`);
    const p = await progress();
    assert.equal(p.rides, i, `after ride ${i}`);
    assert.equal(p.next_is_free, i === 49, `after ride ${i}`);
  }
}

test('49 paid rides, then the 50th is free (and the passenger is told before)', async () => {
  assert.deepEqual(await progress(), { every: 50, rides: 0, needed: 49, next_is_free: false, window_days: 90 });
  await fortyNinePaidRides({ someByMpesa: true });
  const told = (await api('GET', '/notifications', { token: s.token })).body.items.filter((n) => n.kind === 'reward.ready');
  assert.equal(told.length, 1, 'told once, after the 49th');

  const before = await balance();
  const free = await ride();
  assert.equal(free.status, 201);
  assert.equal(free.body.trip.free_ride, 1);
  assert.equal(free.body.trip.fare, 100, 'the owner is paid the full fare');
  assert.equal(await balance(), before, 'nothing taken from the passenger');
  assert.equal((await progress()).rides, 0, 'counting starts again');
});

test('then 49 more paid rides, and the 100th is free too', async () => {
  await fortyNinePaidRides();
  assert.equal((await ride()).body.trip.free_ride, 1);
  const trips = await db.get("SELECT COUNT(*) AS n, SUM(CASE WHEN free_ride THEN 1 ELSE 0 END) AS free, SUM(fare) AS fares FROM trips WHERE passenger_id = ? AND status = 'paid'", s.userId);
  assert.deepEqual([trips.n, trips.free, trips.fares], [100, 2, 10_000], '100 rides, 2 free, the owner owed all 100 fares');
  assert.equal(await balance(), 10_000 - 91 * 100, 'the passenger paid 98 fares: 91 from the wallet, 7 by M-Pesa');
});

test('the money check adds up', async () => {
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});
