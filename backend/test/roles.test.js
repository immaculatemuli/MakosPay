// Phase 1: all five roles, and that each one is refused what it must not do.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

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

  s.platformUser = await createUser({ name: 'Platform Boss', phone: '254700000009', password: 'plat123', role: 'platform_admin' });
  s.platform = await login('0700000009', 'plat123');
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');

  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 80, app_fare: 70 }] } })).body;
  s.other = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Route 46', origin: 'Town', stops: [{ name: 'Kawangware', cash_fare: 70, app_fare: 60 }] } })).body;
  s.stop = route.stops[0];
  s.conductorUser = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian Conductor', phone: '0711111111', password: 'cond123' } })).body;
  s.driverUser = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan Driver', phone: '0711111112', password: 'drive123' } })).body;
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', conductor_id: s.conductorUser.id, driver_id: s.driverUser.id, route_id: route.id },
  })).body;
  s.conductor = await login('0711111111', 'cond123');
  s.driver = await login('0711111112', 'drive123');

  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 500 }));
  s.ticket = (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: 70, idempotency_key: randomUUID() } })).body.trip.ticket_code;
});
after(() => server.close());

test('every role signs in and gets its role', async () => {
  for (const [phone, password, role] of [
    ['0700000009', 'plat123', 'platform_admin'],
    ['0700000001', 'admin123', 'admin'],
    ['0711111111', 'cond123', 'conductor'],
    ['0711111112', 'drive123', 'driver'],
    ['0722333444', 'pass123', 'passenger'],
  ]) {
    assert.equal((await api('POST', '/auth/login', { body: { phone, password } })).body.user.role, role);
  }
});

test('the office manages drivers and puts one on a vehicle', async () => {
  const drivers = (await api('GET', '/admin/drivers', { token: s.admin })).body;
  assert.deepEqual(drivers.map((d) => [d.name, d.vehicle_plate]), [['Dan Driver', 'KDA 123A']]);
  const v = (await api('GET', `/admin/vehicles/${s.vehicle.id}`, { token: s.admin })).body;
  assert.equal(v.driver_name, 'Dan Driver');

  const another = await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777', driver_id: s.driverUser.id } });
  assert.equal(another.status, 409, 'a driver is on one vehicle at a time');
  const notDriver = await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777', driver_id: s.conductorUser.id } });
  assert.equal(notDriver.status, 400, 'a conductor account cannot be the driver');
});

test("the driver sees their vehicle, its payments and can check tickets", async () => {
  const v = (await api('GET', '/crew/vehicle', { token: s.driver })).body;
  assert.equal(v.vehicle.plate, 'KDA 123A');
  const day = (await api('GET', '/crew/payments', { token: s.driver })).body;
  assert.equal(day.summary.payments, 1);
  assert.match(day.payments[0].passenger_phone, /\*\*\*/, 'phone partly hidden');
  assert.equal((await api('GET', `/crew/tickets/${s.ticket}`, { token: s.driver })).status, 200);
});

test('only the conductor can change the route', async () => {
  const byDriver = await api('PUT', '/crew/vehicle/route', { token: s.driver, body: { route_id: s.other.id } });
  assert.equal(byDriver.status, 403);
  const byConductor = await api('PUT', '/crew/vehicle/route', { token: s.conductor, body: { route_id: s.other.id } });
  assert.equal(byConductor.status, 200);
});

test('apps installed before drivers existed still work at the old /conductor address', async () => {
  assert.equal((await api('GET', '/conductor/vehicle', { token: s.conductor })).status, 200);
});

test('switching a driver off signs them out and frees the vehicle', async () => {
  await api('PATCH', `/admin/drivers/${s.driverUser.id}`, { token: s.admin, body: { is_active: false } });
  assert.equal((await api('GET', '/crew/vehicle', { token: s.driver })).status, 401);
  assert.equal((await api('GET', `/admin/vehicles/${s.vehicle.id}`, { token: s.admin })).body.driver_id, null);
  await api('PATCH', `/admin/drivers/${s.driverUser.id}`, { token: s.admin, body: { is_active: true } });
  s.driver = await login('0711111112', 'drive123');
});

test('the platform admin can use the SACCO office screens and the platform screens', async () => {
  assert.equal((await api('GET', '/admin/routes', { token: s.platform })).status, 200);
  const sys = (await api('GET', '/platform/system', { token: s.platform })).body;
  assert.equal(sys.live, false, 'mock mode is not real money');
  assert.equal(sys.counts.crew, 2);

  const added = await api('POST', '/platform/admins', { token: s.platform, body: { name: 'Second Boss', phone: '0700000008', password: 'plat456' } });
  assert.equal(added.status, 201);
  assert.equal((await api('PATCH', `/platform/admins/${s.platformUser.id}`, { token: s.platform, body: { is_active: false } })).status, 400, 'cannot switch off yourself');
});

test('the SACCO office cannot reach the platform screens or switch off a platform admin', async () => {
  assert.equal((await api('GET', '/platform/system', { token: s.admin })).status, 403);
  assert.equal((await api('PATCH', `/admin/staff/${s.platformUser.id}`, { token: s.admin, body: { is_active: false } })).status, 404);
});

test('crew and passengers are refused office, platform and each other’s screens', async () => {
  for (const token of [s.conductor, s.driver]) {
    assert.equal((await api('GET', '/admin/payments', { token })).status, 403);
    assert.equal((await api('GET', '/platform/system', { token })).status, 403);
    assert.equal((await api('GET', '/passenger/wallet', { token })).status, 403);
    assert.equal((await api('POST', '/admin/payments/1/refund', { token, body: { reason: 'try' } })).status, 403, 'crew cannot refund');
    assert.equal((await api('PATCH', `/admin/routes/${s.other.id}`, { token, body: { name: 'Hacked' } })).status, 403, 'crew cannot change fares');
  }
  assert.equal((await api('GET', '/crew/payments', { token: s.passenger })).status, 403);
  assert.equal((await api('GET', '/admin/payouts', { token: s.passenger })).status, 403);
  assert.equal((await api('GET', '/crew/payments')).status, 401, 'not signed in');
});

test('the office can reset a driver password', async () => {
  assert.equal((await api('POST', `/admin/users/${s.driverUser.id}/password`, { token: s.admin, body: { new_password: 'newdrive1' } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0711111112', password: 'newdrive1' } })).status, 200);
});

test('deleting a conductor who worked wipes their name and number, frees the vehicle, and keeps the trips', async () => {
  const id = s.conductorUser.id;
  assert.equal((await api('POST', `/admin/conductors/${id}/delete`, { token: s.admin })).status, 200);
  assert.equal((await api('GET', '/crew/vehicle', { token: s.conductor })).status, 401, 'signed out');
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } })).status, 401, "can't sign in");
  assert.equal((await api('GET', `/admin/vehicles/${s.vehicle.id}`, { token: s.admin })).body.conductor_id, null, 'vehicle freed');
  assert.ok(!(await api('GET', '/admin/conductors', { token: s.admin })).body.some((c) => c.id === id), 'no longer listed');
  const left = await db.get('SELECT name, phone FROM users WHERE id = ?', id);
  assert.deepEqual({ ...left }, { name: 'Deleted conductor', phone: `deleted-${id}` }, 'no name or phone left');
  assert.ok((await db.get('SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?', s.vehicle.id)).n > 0, 'trips kept');

  assert.equal((await api('POST', `/admin/conductors/${id}/delete`, { token: s.admin })).status, 404, 'already deleted');
  assert.equal((await api('PATCH', `/admin/conductors/${id}`, { token: s.admin, body: { is_active: true } })).status, 404, "can't be switched back on");
  assert.equal((await api('POST', `/admin/drivers/${id}/delete`, { token: s.admin })).status, 404, 'only the matching role');
  assert.equal((await api('POST', `/admin/conductors/${id}/delete`, { token: s.conductor })).status, 401);

  const again = await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'New Conductor', phone: '0711111111', password: 'cond456' } });
  assert.equal(again.status, 201, 'the phone number can be used again');
});

test('deleting a driver who never worked removes the account completely', async () => {
  const driver = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Temp Driver', phone: '0711111199', password: 'temp123' } })).body;
  await login('0711111199', 'temp123');
  assert.equal((await api('POST', `/admin/drivers/${driver.id}/delete`, { token: s.admin })).status, 200);
  assert.equal(await db.get('SELECT id FROM users WHERE id = ?', driver.id), undefined, 'the account is gone');
  assert.equal((await api('POST', `/admin/drivers/${driver.id}/delete`, { token: s.admin })).status, 404);
});
