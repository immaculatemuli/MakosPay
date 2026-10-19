// The office's "Needs attention" list and the one search box.
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
const attention = async () => (await api('GET', '/admin/attention', { token: s.admin })).body.items;
const keys = async () => (await attention()).map((i) => i.key);

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 120, app_fare: 100 }] } })).body;
  s.driver = (await api('POST', '/admin/drivers', { token: s.admin, body: { name: 'Dan Driver', phone: '0711000001', password: 'drive123' } })).body;
  s.withDriver = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id, driver_id: s.driver.id } })).body;
  s.noRoute = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777' } })).body;
  s.p = (await signUp(api, { name: 'Pat Wanjiku', phone: '0722333444', password: 'pass123' })).body.token;
});
after(() => server.close());

test('cars that can’t work properly are listed, with a filter to see them', async () => {
  const items = await attention();
  const noRoute = items.find((i) => i.key === 'no_route');
  assert.equal(noRoute.count, 1);
  assert.equal(noRoute.link, 'vehicles:no_route');
  assert.equal(items.find((i) => i.key === 'no_driver').count, 1);
  const filtered = (await api('GET', '/admin/vehicles?filter=no_route', { token: s.admin })).body;
  assert.deepEqual(filtered.map((v) => v.plate), ['KDB 222B']);
  assert.equal((await api('GET', '/admin/vehicles?filter=bad', { token: s.admin })).status, 400);
});

test('a new problem report shows until the office opens it', async () => {
  await api('POST', '/passenger/reports', { token: s.p, body: { category: 'other', message: 'Charged but no ticket' } });
  assert.ok((await keys()).includes('reports'));
  await api('GET', '/admin/reports', { token: s.admin });
  assert.ok(!(await keys()).includes('reports'), 'seen');
});

test('money waiting to be sent by hand comes first', async () => {
  await db.insert("INSERT INTO payouts (owner_name, owner_phone, amount, trip_count, status, conversation_id) VALUES ('Mary', '254744555666', 500, 5, 'manual', ?)", randomUUID());
  const items = await attention();
  assert.equal(items[0].key, 'payouts_manual');
  assert.equal(items[0].severity, 'high');
  assert.match(items[0].detail, /KES 500/);
});

test('one search finds cars, people, tickets and parcels', async () => {
  const search = async (q) => (await api('GET', `/admin/search?q=${encodeURIComponent(q)}`, { token: s.admin })).body;
  assert.deepEqual((await search('kda 123')).map((r) => r.title), ['KDA 123A']);
  const byName = await search('wanjiku');
  assert.equal(byName[0].kind, 'person');
  assert.equal(byName[0].link, 'passenger:254722333444');
  assert.equal((await search('0722333444'))[0].title, 'Pat Wanjiku', 'by phone, 07… form');
  assert.equal((await search('Dan'))[0].link, 'crew:driver');

  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 500 }));
  const trip = (await api('POST', '/passenger/pay', { token: s.p, body: { qr: s.withDriver.qr_token, stop_id: s.route.stops[0].id, expected_fare: 100, idempotency_key: randomUUID() } })).body.trip;
  const found = await search(trip.ticket_code.toLowerCase());
  assert.equal(found[0].kind, 'payment');
  assert.equal(found[0].payment.fare, 100);
  assert.match(found[0].link, /^payments:\d{4}-\d{2}-\d{2}$/);

  assert.deepEqual(await search('x'), [], 'too short');
  assert.equal((await api('GET', '/admin/search?q=kda', { token: s.p })).status, 403, 'office only');
});
