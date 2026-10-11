// Phase 4: crew start and end trips (vehicle runs), see each trip's collection, and report problems.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/db.js');
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
const pay = async (stop) =>
  (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } })).body.trip;

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
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'cond123' } })).body;
  const d = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan', phone: '0711111112', password: 'drive123' } })).body;
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', conductor_id: c.id, driver_id: d.id, route_id: route.id },
  })).body;
  s.noRoute = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777' } })).body;
  s.conductor = await login('0711111111', 'cond123');
  s.driver = await login('0711111112', 'drive123');
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  const pid = db.prepare("SELECT id FROM users WHERE phone = '254722333444'").get().id;
  tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
});
after(() => server.close());

test('no trip in progress at first; a payment outside a trip still works', async () => {
  assert.equal((await api('GET', '/crew/runs/current', { token: s.conductor })).body, null);
  const before = await pay(s.ruiru);
  assert.ok(before.ticket_code);
  s.outside = before;
});

test('the driver starts a trip; fares paid during it belong to it, with a summary per stop', async () => {
  const run = await api('POST', '/crew/runs', { token: s.driver });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  assert.equal(run.body.started_by_name, 'Dan');
  assert.equal(run.body.route_name, 'Thika Road');
  s.run = run.body;

  assert.equal((await api('POST', '/crew/runs', { token: s.conductor })).status, 409, 'only one trip at a time per vehicle');

  await pay(s.juja);
  await pay(s.juja);
  const refunded = await pay(s.ruiru);
  await api('POST', `/admin/payments/${refunded.id}/refund`, { token: s.admin, body: { reason: 'Wrong vehicle' } });

  const current = (await api('GET', '/crew/runs/current', { token: s.conductor })).body;
  assert.equal(current.id, s.run.id, 'the conductor sees the trip the driver started');
  assert.deepEqual([current.payments, current.total], [2, 140], 'refunded fare not counted');
  assert.deepEqual(current.by_stop.map((x) => [x.stop_name, x.payments, x.total]), [['Juja', 2, 140]]);
});

test('the conductor ends the trip; it shows in the day list and the office sees it', async () => {
  const ended = await api('POST', `/crew/runs/${s.run.id}/end`, { token: s.conductor });
  assert.equal(ended.status, 200);
  assert.ok(ended.body.ended_at);
  assert.equal(ended.body.ended_by_name, 'Ian');
  assert.equal((await api('POST', `/crew/runs/${s.run.id}/end`, { token: s.conductor })).status, 409, 'already ended');
  assert.equal((await api('GET', '/crew/runs/current', { token: s.driver })).body, null);

  await pay(s.ruiru); // after the trip ended: not part of it
  const day = (await api('GET', '/crew/runs', { token: s.driver })).body;
  assert.deepEqual(day.map((r) => [r.payments, r.total]), [[2, 140]]);

  const office = (await api('GET', `/admin/vehicles/${s.vehicle.id}/runs`, { token: s.admin })).body;
  assert.equal(office.length, 1);
  assert.equal((await api('GET', `/admin/runs/${s.run.id}`, { token: s.admin })).body.total, 140);
});

test('a trip needs a route, and crew only see their own vehicle’s trips', async () => {
  const other = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Otis', phone: '0711111113', password: 'cond123' } })).body;
  await api('PATCH', `/admin/vehicles/${s.noRoute.id}`, { token: s.admin, body: { conductor_id: other.id } });
  const otis = await login('0711111113', 'cond123');
  const noRoute = await api('POST', '/crew/runs', { token: otis });
  assert.equal(noRoute.status, 409);
  assert.equal(noRoute.body.error.code, 'NO_ROUTE');
  assert.equal((await api('GET', `/crew/runs/${s.run.id}`, { token: otis })).status, 404);
  assert.equal((await api('POST', `/crew/runs/${s.run.id}/end`, { token: otis })).status, 404);
});

test('crew report a problem, optionally about a payment on their vehicle', async () => {
  const r = await api('POST', '/crew/reports', { token: s.conductor, body: { category: 'payment_problem', trip_id: s.outside.id, message: 'Passenger says ticket did not show' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const office = (await api('GET', '/admin/reports', { token: s.admin })).body;
  assert.equal(office[0].reporter_role, 'conductor');
  assert.equal((await api('GET', '/crew/reports', { token: s.conductor })).body.length, 1);

  const passengerTrip = (await api('GET', '/passenger/trips', { token: s.passenger })).body.items[0];
  const otherVehicleTrip = db.prepare('INSERT INTO trips (ticket_code, passenger_id, vehicle_id, route_id, owner_name, owner_phone, fare, cash_fare, idempotency_key) SELECT ?, passenger_id, ?, route_id, owner_name, owner_phone, fare, cash_fare, ? FROM trips WHERE id = ?').run('ZZZ999', s.noRoute.id, 'other-vehicle', passengerTrip.id);
  const notOurs = await api('POST', '/crew/reports', { token: s.conductor, body: { category: 'other', trip_id: Number(otherVehicleTrip.lastInsertRowid), message: 'Not on my vehicle' } });
  assert.equal(notOurs.status, 400);
});

test('starting and ending trips is in the audit log', async () => {
  const log = (await api('GET', '/admin/audit?limit=100', { token: s.admin })).body.items.map((e) => e.action);
  assert.ok(log.includes('POST /crew/runs'));
  assert.ok(log.includes('POST /crew/runs/:id/end'));
});

test('passengers cannot start trips', async () => {
  assert.equal((await api('POST', '/crew/runs', { token: s.passenger })).status, 403);
});
