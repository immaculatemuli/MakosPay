// Step 6: the SACCO office sees all payments, and owners are paid their fares to M-Pesa
// (against a local fake of Safaricom's B2C API).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

const fake = { b2c: [], reject: false };
const daraja = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (req.url.startsWith('/oauth/v1/generate')) return send(200, { access_token: 'tok', expires_in: '3599' });
  if (req.url === '/mpesa/b2c/v3/paymentrequest') {
    const body = JSON.parse(raw);
    if (fake.reject) return send(400, { errorMessage: 'Invalid PartyB' });
    fake.b2c.push(body);
    return send(200, { OriginatorConversationID: body.OriginatorConversationID, ConversationID: `AG_${fake.b2c.length}`, ResponseCode: '0' });
  }
  send(404, {});
});
await new Promise((resolve) => daraja.listen(0, resolve));

process.env.DB_PATH = ':memory:';
process.env.PAYOUTS_NEED_DRIVER = 'false'; // these tests pay owners without the driver's "Send to owner"
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
const b2cResult = (conversationId, ok = true) =>
  api('POST', '/mpesa/callback/cbsecret/b2c/result', {
    body: {
      Result: ok
        ? { ResultCode: 0, OriginatorConversationID: conversationId, TransactionID: 'SJK9B2C001', ResultDesc: 'ok' }
        : { ResultCode: 2001, OriginatorConversationID: conversationId, ResultDesc: 'The initiator information is invalid.' },
    },
  });
const owed = async () => (await api('GET', '/admin/payouts/owed', { token: s.admin })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  const route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 80, app_fare: 70 }, { name: 'Thika', cash_fare: 100, app_fare: 90 }] },
  })).body;
  [s.juja, s.thika] = route.stops;
  // Mary owns two vehicles; John owns one.
  const add = async (plate, owner_name, owner_phone) =>
    (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name, owner_phone, route_id: route.id } })).body;
  s.kda = await add('KDA 123A', 'Mary Owner', '0744555666');
  s.kdb = await add('KDB 456B', 'Mary Owner', '0744555666');
  s.kdc = await add('KDC 789C', 'John Owner', '0755666777');

  s.passenger = (await signUp(api, { name: 'Pat Passenger', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
  await pay(s.kda, s.juja); // 70 Mary
  await pay(s.kda, s.thika); // 90 Mary
  await pay(s.kdb, s.juja); // 70 Mary
  await pay(s.kdc, s.thika); // 90 John
});
after(() => {
  server.close();
  daraja.close();
});

test("the office sees today's payments, totals and each vehicle's takings", async () => {
  const { body } = await api('GET', '/admin/payments', { token: s.admin });
  assert.equal(body.payments.length, 4);
  assert.equal(body.summary.payments, 4);
  assert.equal(body.summary.total, 320);
  assert.deepEqual(body.summary.by_vehicle.map((v) => [v.plate, v.payments, v.total]), [['KDA 123A', 2, 160], ['KDC 789C', 1, 90], ['KDB 456B', 1, 70]]);
  assert.equal(body.payments[0].passenger_name, 'Pat Passenger');

  const one = (await api('GET', `/admin/payments?vehicle_id=${s.kdc.id}`, { token: s.admin })).body;
  assert.deepEqual(one.payments.map((p) => p.plate), ['KDC 789C']);

  const home = (await api('GET', '/admin/summary', { token: s.admin })).body;
  assert.equal(home.today.total, 320);
  assert.equal(home.owed_to_owners, 320);
});

test('what each owner is owed, across all their vehicles', async () => {
  const o = await owed();
  assert.equal(o.automatic, true);
  assert.deepEqual(
    o.owners.map((x) => [x.owner_name, x.owner_phone, x.amount, x.trip_count, x.plates.sort()]),
    [
      ['Mary Owner', '254744555666', 230, 3, ['KDA 123A', 'KDB 456B']],
      ['John Owner', '254755666777', 90, 1, ['KDC 789C']],
    ],
  );
});

test('pay now: one M-Pesa payment to the owner for everything owed, confirmed by M-Pesa', async () => {
  const p = await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0744555666' } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.status, 'processing');
  assert.equal(p.body.amount, 230);
  const sent = fake.b2c.at(-1);
  assert.equal(sent.PartyB, '254744555666');
  assert.equal(sent.Amount, 230);
  assert.match(sent.Remarks, /KDA 123A/);
  assert.match(sent.ResultURL, /\/hooks\/cbsecret\/b2c\/result$/);

  assert.deepEqual((await owed()).owners.map((x) => x.owner_name), ['John Owner'], "Mary's fares are no longer owed");
  const again = await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0744555666' } });
  assert.equal(again.status, 409, 'nothing left to pay Mary');

  await b2cResult(p.body.conversation_id);
  const done = (await api('GET', `/admin/payouts/${p.body.id}`, { token: s.admin })).body;
  assert.equal(done.status, 'completed');
  assert.equal(done.reference, 'SJK9B2C001');
  assert.equal(done.trips.length, 3);

  await b2cResult(p.body.conversation_id, false);
  assert.equal((await api('GET', `/admin/payouts/${p.body.id}`, { token: s.admin })).body.status, 'completed', 'a late duplicate changes nothing');
});

test('a failed payout puts the fares back as owed', async () => {
  const p = (await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0755666777' } })).body;
  await b2cResult(p.conversation_id, false);
  const failed = (await api('GET', `/admin/payouts/${p.id}`, { token: s.admin })).body;
  assert.equal(failed.status, 'failed');
  assert.match(failed.result_desc, /initiator/);
  assert.deepEqual((await owed()).owners.map((x) => [x.owner_name, x.amount]), [['John Owner', 90]]);
});

test('if M-Pesa refuses the request, the payout fails at once and nothing is lost', async () => {
  fake.reject = true;
  const p = (await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0755666777' } })).body;
  fake.reject = false;
  assert.equal(p.status, 'failed');
  assert.match(p.result_desc, /Invalid PartyB/);
  assert.equal((await owed()).owners[0].amount, 90);
});

test('manual payout: the office sends the money itself and records the M-Pesa code', async () => {
  const p = (await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0755666777', manual: true } })).body;
  assert.equal(p.status, 'manual');
  const sent = fake.b2c.length;
  const done = (await api('POST', `/admin/payouts/${p.id}/complete`, { token: s.admin, body: { reference: 'QWE123RTY' } })).body;
  assert.equal(done.status, 'completed');
  assert.equal(fake.b2c.length, sent, 'no M-Pesa request for a manual payout');
  assert.deepEqual((await owed()).owners, []);
});

test('pay everyone now pays every owner who is owed, once', async () => {
  await pay(s.kda, s.juja);
  await pay(s.kdc, s.juja);
  const paid = (await api('POST', '/admin/payouts/run', { token: s.admin })).body;
  assert.deepEqual(paid.map((x) => [x.owner_name, x.amount]).sort(), [['John Owner', 70], ['Mary Owner', 70]]);
  assert.deepEqual((await api('POST', '/admin/payouts/run', { token: s.admin })).body, []);
  const list = (await api('GET', '/admin/payouts', { token: s.admin })).body;
  assert.equal(list.length, 6);
});

test('passengers and conductors cannot see payouts', async () => {
  assert.equal((await api('GET', '/admin/payouts', { token: s.passenger })).status, 403);
});
