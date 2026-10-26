// The owner's FarePay money waits until the car's DRIVER taps "Send to owner"; then the owner is paid at once.
// The conductor can't see or send it, and the office's "Pay now" and the daily run pay only what drivers released.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

const fake = { b2c: [] };
const daraja = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (req.url.startsWith('/oauth/v1/generate')) return send(200, { access_token: 'tok', expires_in: '3599' });
  if (req.url === '/mpesa/b2c/v3/paymentrequest') {
    const body = JSON.parse(raw);
    fake.b2c.push(body);
    return send(200, { OriginatorConversationID: body.OriginatorConversationID, ConversationID: `AG_${fake.b2c.length}`, ResponseCode: '0' });
  }
  send(404, {});
});
await new Promise((resolve) => daraja.listen(0, resolve));

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'sandbox';
process.env.MPESA_BASE_URL = `http://127.0.0.1:${daraja.address().port}`;
process.env.MPESA_CONSUMER_KEY = 'key';
process.env.MPESA_CONSUMER_SECRET = 'secret';
process.env.MPESA_PASSKEY = 'pk';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';
process.env.MPESA_B2C_SHORTCODE = '600989';
process.env.MPESA_B2C_INITIATOR_NAME = 'testapi';
process.env.MPESA_B2C_SECURITY_CREDENTIAL = 'cred';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { payEveryone } = await import('../src/services/payouts.js');

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
const pay = (vehicle, stop) =>
  api('POST', '/passenger/pay', { token: s.passenger, body: { qr: vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } });
const login = async (phone, password) => (await api('POST', '/auth/login', { body: { phone, password } })).body.token;
const owed = async () => (await api('GET', '/admin/payouts/owed', { token: s.admin })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  await createUser({ name: 'Dan Driver', phone: '254700000002', password: 'Adrive123', role: 'driver' });
  await createUser({ name: 'Connie Conductor', phone: '254700000003', password: 'Acond123', role: 'conductor' });
  s.admin = await login('0700000001', 'admin123');
  s.driver = await login('0700000002', 'Adrive123');
  s.conductor = await login('0700000003', 'Acond123');

  const route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 80, app_fare: 70 }, { name: 'Thika', cash_fare: 100, app_fare: 90 }] },
  })).body;
  [s.juja, s.thika] = route.stops;
  s.car = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary Owner', owner_phone: '0744555666', route_id: route.id } })).body;
  // The crew take their places on the car by scanning its sticker.
  for (const token of [s.driver, s.conductor]) {
    const claimed = await api('POST', '/crew/vehicle/claim', { token, body: { qr: s.car.qr_token } });
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  }

  s.passenger = (await signUp(api, { name: 'Pat Passenger', phone: '0722333444', password: 'Apass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
  await pay(s.car, s.juja); // 70
  await pay(s.car, s.thika); // 90
});
after(() => {
  server.close();
  daraja.close();
});

test('fares wait for the driver: the office and the daily run pay nothing yet', async () => {
  const o = await owed();
  assert.deepEqual(o.owners, []);
  assert.deepEqual(o.waiting_for_drivers, { cars: 1, fares: 2, total: 160 });
  assert.deepEqual(await payEveryone(), []);
  const p = await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0744555666' } });
  assert.equal(p.status, 409);
  assert.equal(fake.b2c.length, 0);
});

test('the conductor can neither see nor send the owner money', async () => {
  const seen = await api('GET', '/crew/owner-money', { token: s.conductor });
  assert.equal(seen.status, 403);
  const sent = await api('POST', '/crew/owner-money/send', { token: s.conductor });
  assert.equal(sent.status, 403);
  assert.match(sent.body.error.message, /Only the driver/);
  assert.equal(fake.b2c.length, 0);
});

test('the driver sees what is waiting and sends it: the owner is paid at once', async () => {
  const seen = await api('GET', '/crew/owner-money', { token: s.driver });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.waiting, { fares: 2, total: 160 });

  const sent = await api('POST', '/crew/owner-money/send', { token: s.driver });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.total, 160);
  assert.deepEqual(sent.body.payouts.map((p) => [p.amount, p.status]), [[160, 'processing']]);
  assert.equal(fake.b2c.at(-1).PartyB, '254744555666');
  assert.equal(fake.b2c.at(-1).Amount, 160);
  const driverId = (await db.get("SELECT id FROM users WHERE phone = '254700000002'")).id;
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM trips WHERE released_by = ?', driverId)).n, 2);

  // Nothing new: nothing to send twice.
  const again = await api('POST', '/crew/owner-money/send', { token: s.driver });
  assert.equal(again.status, 409);
  assert.equal(fake.b2c.length, 1);
  assert.deepEqual((await api('GET', '/crew/owner-money', { token: s.driver })).body.waiting, { fares: 0, total: 0 });
});

test('a fare paid after the send waits for the next one', async () => {
  await pay(s.car, s.juja);
  assert.deepEqual((await owed()).waiting_for_drivers, { cars: 1, fares: 1, total: 70 });
  assert.deepEqual((await owed()).owners, []);
});
