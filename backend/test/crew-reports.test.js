// Crew (conductors and drivers) report problems, optionally about a payment on their vehicle.
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

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  const route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }] },
  })).body;
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'Acond123' } })).body;
  const d = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan', phone: '0711111112', password: 'Adrive123' } })).body;
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', conductor_id: c.id, driver_id: d.id, route_id: route.id },
  })).body;
  s.other = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777' } })).body;
  s.conductor = await login('0711111111', 'Acond123');
  s.driver = await login('0711111112', 'Adrive123');
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'Apass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
  const stop = route.stops[0];
  s.payment = (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } })).body.trip;
});
after(() => server.close());

test('crew report a problem, optionally about a payment on their vehicle', async () => {
  const r = await api('POST', '/crew/reports', { token: s.conductor, body: { category: 'payment_problem', trip_id: s.payment.id, message: 'Passenger says ticket did not show' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const office = (await api('GET', '/admin/reports', { token: s.admin })).body;
  assert.equal(office[0].reporter_role, 'conductor');
  assert.equal((await api('GET', '/crew/reports', { token: s.conductor })).body.length, 1);
  assert.equal((await api('POST', '/crew/reports', { token: s.driver, body: { category: 'other', message: 'Brake light out' } })).status, 201);

  const otherVehicleTripId = (await db.insert('INSERT INTO trips (ticket_code, passenger_id, vehicle_id, route_id, owner_name, owner_phone, fare, cash_fare, idempotency_key) SELECT ?, passenger_id, ?, route_id, owner_name, owner_phone, fare, cash_fare, ? FROM trips WHERE id = ?', 'ZZZ999', s.other.id, 'other-vehicle', s.payment.id));
  const notOurs = await api('POST', '/crew/reports', { token: s.conductor, body: { category: 'other', trip_id: otherVehicleTripId, message: 'Not on my vehicle' } });
  assert.equal(notOurs.status, 400);
});

test('passengers cannot use crew reports', async () => {
  assert.equal((await api('POST', '/crew/reports', { token: s.passenger, body: { category: 'other', message: 'Hello there' } })).status, 403);
});
