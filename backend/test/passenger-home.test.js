// Phase 2: passenger home (savings, trips, frequent and saved drop-offs) and problem reports.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SACCO_NAME = 'Super Thika SACCO';

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
const pay = (stop) =>
  api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } });
const summary = async () => (await api('GET', '/passenger/summary', { token: s.passenger })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }, { name: 'Juja', cash_fare: 80, app_fare: 60 }] },
  })).body;
  [s.ruiru, s.juja] = s.route.stops;
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id } })).body;
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  s.other = (await api('POST', '/auth/register', { body: { name: 'Other', phone: '0722333555', password: 'pass123' } })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
});
after(() => server.close());

test('a new passenger: SACCO name, balance, nothing saved yet', async () => {
  const h = await summary();
  assert.equal(h.sacco_name, 'Super Thika SACCO');
  assert.equal(h.balance, 1000);
  assert.deepEqual([h.this_month.trips, h.this_month.saved, h.since_joining.saved], [0, 0, 0]);
  assert.deepEqual([h.frequent, h.saved], [[], []]);
});

test('savings and trips come from verified payments; refunded fares do not count', async () => {
  await pay(s.juja); // saves 20
  await pay(s.juja); // saves 20
  const refunded = (await pay(s.ruiru)).body.trip; // saves 10, then refunded
  await api('POST', `/admin/payments/${refunded.id}/refund`, { token: s.admin, body: { reason: 'Breakdown' } });

  const h = await summary();
  assert.deepEqual(h.this_month, { trips: 2, saved: 40, spent: 120 });
  assert.equal(h.since_joining.saved, 40);
  assert.ok(h.since_joining.joined_at);
  assert.deepEqual(h.frequent.map((f) => [f.stop_name, f.route_name, f.app_fare]), [['Juja', 'Thika Road', 60]]);
});

test('older savings count since joining but not this month', async () => {
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  (await db.run("UPDATE trips SET created_at = '2020-01-15T08:00:00.000Z' WHERE id = (SELECT MIN(id) FROM trips WHERE passenger_id = ?)", pid));
  const h = await summary();
  assert.equal(h.this_month.saved, 20);
  assert.equal(h.since_joining.saved, 40);
});

test('saving and removing a drop-off', async () => {
  assert.equal((await api('POST', '/passenger/saved-stops', { token: s.passenger, body: { stop_id: s.ruiru.id } })).status, 201);
  await api('POST', '/passenger/saved-stops', { token: s.passenger, body: { stop_id: s.ruiru.id } }); // twice is fine
  assert.deepEqual((await summary()).saved.map((x) => x.stop_name), ['Ruiru']);
  assert.equal((await api('POST', '/passenger/saved-stops', { token: s.passenger, body: { stop_id: 9999 } })).status, 404);
  await api('DELETE', `/passenger/saved-stops/${s.ruiru.id}`, { token: s.passenger });
  assert.deepEqual((await summary()).saved, []);
});

test('a passenger reports a problem with one of their payments and sees the office reply', async () => {
  const trip = (await api('GET', '/passenger/trips', { token: s.passenger })).body.items[0];
  const r = await api('POST', '/passenger/reports', { token: s.passenger, body: { category: 'duplicate_charge', trip_id: trip.id, message: 'I was charged twice on KDA 123A' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'open');
  assert.equal(r.body.plate, 'KDA 123A');

  const notMine = await api('POST', '/passenger/reports', { token: s.other, body: { category: 'other', trip_id: trip.id, message: 'Not my trip at all' } });
  assert.equal(notMine.status, 400, "can't report about someone else's payment");
  assert.equal((await api('POST', '/passenger/reports', { token: s.passenger, body: { category: 'other', message: 'hi' } })).status, 400, 'too short');

  const office = (await api('GET', '/admin/reports?status=open', { token: s.admin })).body;
  assert.equal(office.length, 1);
  assert.equal(office[0].reporter_name, 'Pat');
  assert.equal((await api('GET', '/admin/summary', { token: s.admin })).body.open_reports, 1);

  const done = await api('PATCH', `/admin/reports/${office[0].id}`, { token: s.admin, body: { status: 'resolved', office_note: 'Refunded the second charge' } });
  assert.equal(done.body.status, 'resolved');
  const mine = (await api('GET', '/passenger/reports', { token: s.passenger })).body;
  assert.deepEqual([mine[0].status, mine[0].office_note], ['resolved', 'Refunded the second charge']);
  assert.deepEqual((await api('GET', '/passenger/reports', { token: s.other })).body, [], "others don't see it");
});

test('reports are limited per day', async () => {
  for (let i = 0; i < 9; i++) await api('POST', '/passenger/reports', { token: s.passenger, body: { category: 'other', message: `Report number ${i}` } });
  const r = await api('POST', '/passenger/reports', { token: s.passenger, body: { category: 'other', message: 'One too many' } });
  assert.equal(r.status, 429);
});

test('crew and passengers cannot see or change the office report list', async () => {
  assert.equal((await api('GET', '/admin/reports', { token: s.passenger })).status, 403);
  assert.equal((await api('PATCH', '/admin/reports/1', { token: s.passenger, body: { status: 'resolved' } })).status, 403);
});
