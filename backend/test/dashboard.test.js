// Phase 5: the SACCO office dashboard (collections by day, route, vehicle, stop and hour).
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
const { nairobiDayRange, nairobiToday } = await import('../src/util.js');

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
const pay = async (stop) =>
  (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } })).body.trip;
const daysAgo = (n) => new Date(Date.parse(`${nairobiToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
// Moves a payment to a Kenyan date and time (stored in UTC).
const moveTo = async (tripId, date, time) => (await db.run('UPDATE trips SET created_at = ? WHERE id = ?', new Date(`${date}T${time}:00.000+03:00`).toISOString(), tripId));

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  const route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }, { name: 'Juja', cash_fare: 80, app_fare: 70 }] },
  })).body;
  [s.ruiru, s.juja] = route.stops;
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: route.id } })).body;
  s.idle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777', route_id: route.id } })).body;
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body.token;
  s.passengerId = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(s.passengerId, { type: 'test_credit', amount: 2000 }));

  // Today: 2 x Juja (70) at 07:xx and 1 x Ruiru (50) refunded.
  await moveTo((await pay(s.juja)).id, nairobiToday(), '07:10');
  await moveTo((await pay(s.juja)).id, nairobiToday(), '07:40');
  const refunded = await pay(s.ruiru);
  await api('POST', `/admin/payments/${refunded.id}/refund`, { token: s.admin, body: { reason: 'Wrong vehicle' } });
  // 2 days ago at 00:30 Kenyan time (still the previous UTC day): must count on its Kenyan day.
  await moveTo((await pay(s.ruiru)).id, daysAgo(2), '00:30');
  // 10 days ago: outside the last 7 days, inside the 7 before.
  await moveTo((await pay(s.ruiru)).id, daysAgo(10), '18:00');
  // A completed M-Pesa top-up today.
  (await db.run("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, created_at) VALUES (?, '254722333444', 300, 'wallet', 'completed', ?)", s.passengerId, nairobiDayRange(nairobiToday())[0]));
});
after(() => server.close());

test('last 7 days: totals, refunds, top-ups and the week before', async () => {
  const d = (await api('GET', '/admin/dashboard', { token: s.admin })).body;
  assert.equal(d.days, 7);
  assert.equal(d.to_date, nairobiToday());
  assert.equal(d.from_date, daysAgo(6));
  assert.equal(d.real_money, false);
  assert.deepEqual(d.totals, { payments: 3, collected: 190, passengers: 1, passengers_saved: 10 + 10 + 10 });
  assert.deepEqual(d.previous, { payments: 1, collected: 50, passengers: 1, passengers_saved: 10 });
  assert.deepEqual(d.refunds, { count: 1, amount: 50 });
  assert.deepEqual(d.topups, { count: 1, amount: 300 });
});

test('every day is listed, and payments land on their Kenyan day', async () => {
  const d = (await api('GET', '/admin/dashboard', { token: s.admin })).body;
  assert.equal(d.by_day.length, 7);
  assert.deepEqual(d.by_day.at(-1), { date: nairobiToday(), payments: 2, total: 140 });
  assert.deepEqual(d.by_day.find((x) => x.date === daysAgo(2)), { date: daysAgo(2), payments: 1, total: 50 });
  assert.equal(d.by_day.reduce((sum, x) => sum + x.total, 0), d.totals.collected);
});

test('by route, vehicle (idle ones too), stop and hour', async () => {
  const d = (await api('GET', '/admin/dashboard', { token: s.admin })).body;
  assert.deepEqual(d.by_route.map((r) => [r.name, r.payments, r.total]), [['Thika Road', 3, 190]]);
  assert.deepEqual(d.by_vehicle.map((v) => [v.plate, v.payments, v.total]), [['KDA 123A', 3, 190], ['KDB 222B', 0, 0]]);
  assert.deepEqual(d.top_stops.map((x) => [x.stop_name, x.payments]), [['Juja', 2], ['Ruiru', 1]]);
  assert.deepEqual(d.by_hour, [{ hour: 0, payments: 1 }, { hour: 7, payments: 2 }]);
});

test('last 30 days includes the older payment', async () => {
  const d = (await api('GET', '/admin/dashboard?days=30', { token: s.admin })).body;
  assert.equal(d.by_day.length, 30);
  assert.equal(d.totals.collected, 240);
  assert.equal((await api('GET', '/admin/dashboard?days=12', { token: s.admin })).status, 400);
});

test('only the office can see the dashboard', async () => {
  assert.equal((await api('GET', '/admin/dashboard', { token: s.passenger })).status, 403);
});
