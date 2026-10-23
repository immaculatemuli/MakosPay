// Step 5: the conductor sees every payment on their vehicle, checks tickets and changes the route.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

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

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 80, app_fare: 70 }, { name: 'Thika', cash_fare: 100, app_fare: 90 }] },
  })).body;
  s.other = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Route 46', origin: 'Town', stops: [{ name: 'Kawangware', cash_fare: 70, app_fare: 60 }] },
  })).body;
  const ian = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'cond123' } })).body;
  await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Free Conductor', phone: '0711111112', password: 'cond123' } });
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', owner_name: 'Mary Owner', owner_phone: '0744555666', conductor_id: ian.id, route_id: s.route.id },
  })).body;
  s.conductor = (await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } })).body.token;
  s.free = (await api('POST', '/auth/login', { body: { phone: '0711111112', password: 'cond123' } })).body.token;

  s.passenger = (await signUp(api, { name: 'Pat Passenger', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 500 }));
  for (const stop of s.route.stops) {
    const r = await api('POST', '/passenger/pay', {
      token: s.passenger,
      body: { qr: s.vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() },
    });
    s.ticket = r.body.trip.ticket_code;
  }
});
after(() => server.close());

test("the conductor sees their vehicle, route and today's totals", async () => {
  const { body } = await api('GET', '/conductor/vehicle', { token: s.conductor });
  assert.equal(body.vehicle.plate, 'KDA 123A');
  assert.equal(body.route.name, 'Thika Road');
  assert.deepEqual(body.today, { payments: 2, total: 160 });
});

test("today's payments: who paid, where they're going, phone partly hidden, no owner details", async () => {
  const { body } = await api('GET', '/conductor/payments', { token: s.conductor });
  assert.deepEqual(body.summary, { payments: 2, total: 160 });
  assert.deepEqual(body.payments.map((p) => [p.stop_name, p.fare]), [['Thika', 90], ['Juja', 70]]);
  assert.equal(body.payments[0].passenger_name, 'Pat Passenger');
  assert.equal(body.payments[0].passenger_phone, '0722***444');
  assert.equal(body.payments[0].owner_phone, undefined);

  const yesterday = new Date(Date.now() + 3 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  const old = await api('GET', `/conductor/payments?date=${yesterday}`, { token: s.conductor });
  assert.deepEqual(old.body.summary, { payments: 0, total: 0 });
});

test('checking a ticket code', async () => {
  const ok = await api('GET', `/conductor/tickets/${s.ticket.toLowerCase()}`, { token: s.conductor });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.is_today, true);
  assert.equal(ok.body.payment.stop_name, 'Thika');

  const wrong = await api('GET', '/conductor/tickets/ZZZZZZ', { token: s.conductor });
  assert.equal(wrong.status, 404);
  assert.equal(wrong.body.error.code, 'TICKET_NOT_FOUND');
});

test('a conductor not on any vehicle is told to ask the SACCO office', async () => {
  const r = await api('GET', '/conductor/payments', { token: s.free });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NO_VEHICLE');
  assert.equal((await api('GET', `/conductor/tickets/${s.ticket}`, { token: s.free })).status, 404, "can't check other vehicles' tickets");
});

test('changing route: passengers who scan afterwards see the new route', async () => {
  const routes = (await api('GET', '/conductor/routes', { token: s.conductor })).body;
  assert.deepEqual(routes.map((r) => r.name), ['Route 46', 'Thika Road']);
  const changed = await api('PUT', '/conductor/vehicle/route', { token: s.conductor, body: { route_id: s.other.id } });
  assert.equal(changed.body.route.name, 'Route 46');
  const scan = (await api('GET', `/passenger/scan?qr=${s.vehicle.qr_token}`, { token: s.passenger })).body;
  assert.equal(scan.route.name, 'Route 46');
});

test('passengers and the office cannot use the conductor screens', async () => {
  assert.equal((await api('GET', '/conductor/payments', { token: s.passenger })).status, 403);
  assert.equal((await api('GET', '/conductor/payments', { token: s.admin })).status, 403);
});
