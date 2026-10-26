// At night, trips the crew never marked finished (and cars left "loading" at the stage) are closed, so every car
// starts the morning fresh.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { closeStaleTrips } = await import('../src/services/bookings.js');

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
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos - Nairobi', origin: 'Machakos', stops: [{ name: 'Athi River', fare: 150 }] } })).body;
  for (const [n, phone] of [['One', '0711000001'], ['Two', '0711000002']]) {
    await api('POST', '/admin/conductors', { token: s.admin, body: { name: `Conductor ${n}`, phone, password: 'Acond123' } });
    const id = (await db.get('SELECT id FROM users WHERE phone = ?', `254${phone.slice(1)}`)).id;
    await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: `KDA 00${n.length}${n[0]}`, owner_name: 'Owner', owner_phone: '0744555666', route_id: route.id, conductor_id: id } });
  }
  s.one = await login('0711000001', 'Acond123');
  s.two = await login('0711000002', 'Acond123');
});
after(() => server.close());

test('a trip left on the road and a car left loading are closed for the night', async () => {
  assert.equal((await api('POST', '/crew/loading/start', { token: s.one })).status < 300, true);
  assert.equal((await api('POST', '/crew/loading/depart', { token: s.one })).status < 300, true);
  assert.equal((await api('POST', '/crew/loading/start', { token: s.two })).status < 300, true);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM loads WHERE finished_at IS NULL")).n, 2);

  assert.equal(await closeStaleTrips(), 2);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM loads WHERE finished_at IS NULL')).n, 0, 'nothing left open');
  assert.equal(await closeStaleTrips(), 0, 'running it again changes nothing');

  // Next morning both cars can load again.
  assert.equal((await api('POST', '/crew/loading/start', { token: s.one })).status < 300, true);
  assert.equal((await api('POST', '/crew/loading/start', { token: s.two })).status < 300, true);
});
