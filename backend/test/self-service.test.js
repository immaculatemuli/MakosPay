// Fewer calls to the office: owners are texted what they were paid and from which cars; the office messages crew in bulk;
// drivers reset their own password by SMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.PAYOUTS_NEED_DRIVER = 'false'; // these tests pay owners without the driver's "Send to owner"
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SMS_PROVIDER = 'log';

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
const texts = (phone) => db.all('SELECT kind, message FROM sms_outbox WHERE phone = ? ORDER BY id', phone);
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Grace Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.thika = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 120, app_fare: 100 }] } })).body;
  s.msa = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Mombasa Road', origin: 'Town', stops: [{ name: 'Athi River', cash_fare: 150, app_fare: 150 }] } })).body;
  const crew = (n, role) => api('POST', `/admin/${role}s`, { token: s.admin, body: { name: `${role} ${n}`, phone: `07110000${n}`, password: 'crew123' } });
  s.d1 = (await crew('01', 'driver')).body;
  s.d2 = (await crew('02', 'driver')).body;
  s.c1 = (await crew('03', 'conductor')).body;
  await crew('04', 'marshal');
  const car = (plate, route, extra) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: route.id, owner_name: 'Mary Wanjiru', owner_phone: '0744555666', ...extra } });
  s.a = (await car('KDA 001A', s.thika, { driver_id: s.d1.id, conductor_id: s.c1.id })).body;
  s.b = (await car('KDA 002A', s.thika, {})).body;
  s.c = (await car('KDB 003B', s.msa, { driver_id: s.d2.id })).body;
  s.p = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 5000 }));
});
after(() => server.close());

test('the owner is texted what reached them and from which cars', async () => {
  const pay = (v, stop, fare) => api('POST', '/passenger/pay', { token: s.p, body: { qr: v.qr_token, stop_id: stop.id, expected_fare: fare, idempotency_key: randomUUID() } });
  await pay(s.a, s.thika.stops[0], 100);
  await pay(s.a, s.thika.stops[0], 100);
  await pay(s.c, s.msa.stops[0], 150);
  const run = await api('POST', '/admin/payouts/run', { token: s.admin });
  assert.ok(run.status < 300, JSON.stringify(run.body));
  const [sms] = (await texts('254744555666')).filter((t) => t.kind === 'payout.owner');
  assert.ok(sms, 'texted');
  assert.match(sms.message, /KES 350 sent to your M-Pesa \(\w+\)\. 3 fares from 2 cars: KDA 001A 200, KDB 003B 150\./);
});

test('the office messages all crew on a route, or the marshals, by notification and optionally SMS', async () => {
  const count = (q) => api('GET', `/admin/broadcast/count?${q}`, { token: s.admin }).then((r) => r.body.count);
  assert.equal(await count(`audience=drivers&route_id=${s.thika.id}`), 1);
  assert.equal(await count(`audience=crew&route_id=${s.thika.id}`), 2, 'driver and conductor');
  assert.equal(await count('audience=drivers'), 2, 'all routes');
  assert.equal(await count('audience=marshals'), 1);

  const sent = await api('POST', '/admin/broadcast', { token: s.admin, body: { audience: 'crew', route_id: s.thika.id, message: 'Thika Road closed at Juja, use the bypass', sms: true } });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.deepEqual(sent.body, { sent_to: 2, by_sms: true });
  const driver = await login('0711000001', 'crew123');
  const notes = (await api('GET', '/notifications', { token: driver })).body.items;
  assert.ok(notes.some((n) => n.title === 'Message from the SACCO office (Thika Road)' && n.body === 'Thika Road closed at Juja, use the bypass'));
  assert.match((await texts('254711000003')).at(-1).message, /use the bypass — Grace Office, SACCO office/);
  const other = await login('0711000002', 'crew123');
  assert.ok(!(await api('GET', '/notifications', { token: other })).body.items.some((n) => n.kind === 'broadcast'), 'not the Mombasa Road driver');

  const none = await api('POST', '/admin/broadcast', { token: s.admin, body: { audience: 'drivers', route_id: 999, message: 'Hello there' } });
  assert.equal(none.status, 409);
  assert.equal((await api('POST', '/admin/broadcast', { token: driver, body: { audience: 'drivers', message: 'Hi all' } })).status, 403);
});

test('a driver resets their own password by SMS, without the office', async () => {
  const asked = await api('POST', '/auth/password-reset/request', { body: { phone: '0711000001' } });
  assert.equal(asked.status, 200);
  const sms = (await texts('254711000001')).find((t) => t.kind === 'password_reset');
  const code = sms.message.match(/\d{6}/)[0];
  assert.equal(asked.body.test_code, code, 'SMS test mode: the app is given the code to show');
  assert.equal((await api('POST', '/auth/password-reset/confirm', { body: { phone: '0711000001', code, new_password: 'newpass9' } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0711000001', password: 'newpass9' } })).status, 200);
});
