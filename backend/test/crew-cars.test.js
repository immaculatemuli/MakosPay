// Crew choose their car by scanning its sticker: they take their place on it, whoever had it is told, and the office
// can see every move.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');

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
const login = async (phone) => (await api('POST', '/auth/login', { body: { phone, password: 'crew123' } })).body.token;
const crewOf = async (vehicleId) => ({ ...(await db.get('SELECT conductor_id, driver_id FROM vehicles WHERE id = ?', vehicleId)) });
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Machakos', stops: [{ name: 'Nairobi', fare: 100 }] } })).body;
  const add = (role, name, phone) => api('POST', `/admin/${role}s`, { token: s.admin, body: { name, phone, password: 'crew123' } }).then((r) => r.body);
  s.ian = await add('conductor', 'Ian', '0711000001');
  s.joy = await add('conductor', 'Joy', '0711000002');
  s.dan = await add('driver', 'Dan', '0711000003');
  const car = (plate, extra = {}) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: s.route.id, owner_name: 'Mary', owner_phone: '0744555666', ...extra } }).then((r) => r.body);
  s.a = await car('KDA 123A', { conductor_id: s.ian.id });
  s.b = await car('KDB 123S');
  s.off = await car('KDC 999C');
  await api('PATCH', `/admin/vehicles/${s.off.id}`, { token: s.admin, body: { is_active: false } });
  s.ianT = await login('0711000001');
  s.joyT = await login('0711000002');
  s.danT = await login('0711000003');
});
after(() => server.close());

test('a driver with no car scans one and it becomes theirs (as its driver)', async () => {
  assert.equal((await api('GET', '/crew/vehicle', { token: s.danT })).status, 404, 'no car yet');
  const res = await api('POST', '/crew/vehicle/claim', { token: s.danT, body: { qr: s.a.qr_url ?? s.a.qr_token } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.plate, res.body.changed], ['KDA 123A', true]);
  assert.deepEqual(await crewOf(s.a.id), { conductor_id: s.ian.id, driver_id: s.dan.id }, 'the conductor stays');
  assert.equal((await api('GET', '/crew/vehicle', { token: s.danT })).body.vehicle.plate, 'KDA 123A');
});

test('scanning the car you are already on changes nothing', async () => {
  const res = await api('POST', '/crew/vehicle/claim', { token: s.ianT, body: { qr: s.a.qr_token } });
  assert.deepEqual([res.body.plate, res.body.changed], ['KDA 123A', false]);
});

test('moving to another car leaves the old one; taking a car replaces its conductor, who is told', async () => {
  const move = await api('POST', '/crew/vehicle/claim', { token: s.ianT, body: { qr: s.b.qr_token } });
  assert.deepEqual([move.body.plate, move.body.left], ['KDB 123S', 'KDA 123A']);
  assert.equal((await crewOf(s.a.id)).conductor_id, null);
  assert.equal((await crewOf(s.b.id)).conductor_id, s.ian.id);

  const take = await api('POST', '/crew/vehicle/claim', { token: s.joyT, body: { qr: s.b.qr_token } });
  assert.equal(take.status, 200);
  assert.equal((await crewOf(s.b.id)).conductor_id, s.joy.id);
  const told = await db.get("SELECT title, body FROM notifications WHERE user_id = ? AND kind = 'crew.replaced'", s.ian.id);
  assert.equal(told.title, 'You are no longer on KDB 123S');
  assert.match(told.body, /Joy scanned KDB 123S and is now its conductor/);
  assert.equal((await api('GET', '/crew/vehicle', { token: s.ianT })).status, 404, 'Ian has no car now');

  const log = await db.all("SELECT actor_id, details FROM audit_log WHERE action = 'vehicle.crew_scanned_in' ORDER BY id");
  assert.equal(log.length, 3);
  assert.deepEqual(JSON.parse(log[2].details), { role: 'conductor', plate: 'KDB 123S', left_vehicle: null, replaced_user_id: s.ian.id });
});

test('a car taking stage bookings keeps its crew until it leaves', async () => {
  await api('POST', '/crew/loading/start', { token: s.joyT });
  const res = await api('POST', '/crew/vehicle/claim', { token: s.joyT, body: { qr: s.a.qr_token } });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /KDB 123S is taking bookings/);
  await api('POST', '/crew/loading/depart', { token: s.joyT });
  assert.equal((await api('POST', '/crew/vehicle/claim', { token: s.joyT, body: { qr: s.a.qr_token } })).status, 200);
});

test('switched-off cars, unknown codes and other roles are refused', async () => {
  assert.equal((await api('POST', '/crew/vehicle/claim', { token: s.ianT, body: { qr: s.off.qr_token } })).status, 404);
  assert.equal((await api('POST', '/crew/vehicle/claim', { token: s.ianT, body: { qr: 'not-a-car' } })).status, 404);
  assert.equal((await api('POST', '/crew/vehicle/claim', { token: s.admin, body: { qr: s.a.qr_token } })).status, 403);
});
