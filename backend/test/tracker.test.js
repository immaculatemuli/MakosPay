// GPS trackers in the cars, read from a tracking system (Traccar) and matched to cars by car number or plate,
// against a local fake of Traccar's API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

const fake = { devices: [], positions: [], requests: 0 };
const traccar = createServer((req, res) => {
  fake.requests++;
  const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (req.headers.authorization !== `Basic ${Buffer.from('office@makos.test:trackpass').toString('base64')}`) return send(401, {});
  if (req.url === '/api/devices') return send(200, fake.devices);
  if (req.url === '/api/positions') return send(200, fake.positions);
  send(404, {});
});
await new Promise((resolve) => traccar.listen(0, resolve));

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.TRACKER_PROVIDER = 'traccar';
process.env.TRACKER_URL = `http://127.0.0.1:${traccar.address().port}/`;
process.env.TRACKER_EMAIL = 'office@makos.test';
process.env.TRACKER_PASSWORD = 'trackpass';

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { syncTrackers } = await import('../src/services/tracker.js');

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
const where = (vehicleId) => db.get('SELECT lat, lng, speed, recorded_at FROM vehicle_locations WHERE vehicle_id = ?', vehicleId);
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  const car = async (plate) => (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name: 'Mary Owner', owner_phone: '0744555666' } })).body;
  s.first = await car('KDA 123A'); // car number 101
  s.second = await car('KDB 456B'); // car number 102
  await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'cond123' } });
  s.conductor = await login('0711111111', 'cond123');
});
after(() => {
  server.close();
  traccar.close();
});

test('each tracker is matched to its car by car number or plate, and its position becomes the car’s', async () => {
  assert.equal(s.first.car_number, 101);
  fake.devices = [
    { id: 1, name: '101', uniqueId: '867530912345678', status: 'online' },
    { id: 2, name: 'Makos 2', uniqueId: 'kdb-456b', status: 'online' },
    { id: 3, name: 'Spare tracker', uniqueId: '999', status: 'offline' },
  ];
  fake.positions = [
    { deviceId: 1, latitude: -1.5177, longitude: 37.2634, speed: 20, course: 90, accuracy: 5, valid: true, fixTime: minutesAgo(1) },
    { deviceId: 2, latitude: -1.2921, longitude: 36.8219, speed: 0, course: 0, accuracy: 0, valid: true, fixTime: minutesAgo(2) },
  ];
  assert.equal(await syncTrackers(), 2);
  const first = await where(s.first.id);
  assert.deepEqual([first.lat, first.lng], [-1.5177, 37.2634]);
  assert.ok(Math.abs(first.speed - 10.29) < 0.01, 'knots turned into metres per second');
  assert.deepEqual([(await where(s.second.id)).lat], [-1.2921], 'matched by plate, spaces and dashes ignored');

  const status = (await api('GET', '/admin/tracker', { token: s.admin })).body;
  assert.equal(status.error, null);
  assert.equal(status.provider, 'traccar');
  assert.deepEqual(
    status.trackers.map((t) => [t.name, t.vehicle?.plate ?? null, t.position ? 'has position' : 'no position']),
    [
      ['101', 'KDA 123A', 'has position'],
      ['Makos 2', 'KDB 456B', 'has position'],
      ['Spare tracker', null, 'no position'],
    ],
  );
  assert.equal(status.cars.length, 2);
});

test('an older position never replaces a newer one; a newer one does', async () => {
  const before = await where(s.first.id);
  fake.positions[0] = { ...fake.positions[0], latitude: -9, fixTime: minutesAgo(30) };
  await syncTrackers();
  assert.equal((await where(s.first.id)).lat, before.lat);
  fake.positions[0] = { ...fake.positions[0], latitude: -1.52, fixTime: new Date().toISOString() };
  await syncTrackers();
  assert.equal((await where(s.first.id)).lat, -1.52);
});

test('a refused sign-in is shown to the office and changes nothing', async () => {
  const saved = config.tracker.password;
  config.tracker.password = 'wrong';
  try {
    const status = (await api('POST', '/admin/tracker/check', { token: s.admin })).body;
    assert.match(status.error, /refused the sign-in/);
    assert.equal((await where(s.first.id)).lat, -1.52);
  } finally {
    config.tracker.password = saved;
  }
  assert.equal((await api('POST', '/admin/tracker/check', { token: s.admin })).body.error, null, 'fine again');
});

test('only the office sees the tracker page', async () => {
  assert.equal((await api('GET', '/admin/tracker', { token: s.conductor })).status, 403);
  assert.equal((await api('GET', '/admin/tracker')).status, 401);
});
