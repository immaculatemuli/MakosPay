// Step 4: M-Pesa top-ups and fares paid by M-Pesa, against a local fake of Safaricom's Daraja API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

const SHORTCODE = '174379';
const PASSKEY = 'test-passkey';
// What the fake Safaricom answers when asked about each payment: a list of answers, used in turn.
const fake = { requests: [], pushes: 0, answers: {}, defaultAnswers: ['processing', 'paid'] };

const daraja = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  fake.requests.push({ path: req.url, body });
  const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

  if (req.url.startsWith('/oauth/v1/generate')) {
    const expected = 'Basic ' + Buffer.from('key:secret').toString('base64');
    return req.headers.authorization === expected ? send(200, { access_token: 'tok123', expires_in: '3599' }) : send(400, {});
  }
  if (req.headers.authorization !== 'Bearer tok123') return send(401, { errorMessage: 'Invalid Access Token' });

  if (req.url === '/mpesa/stkpush/v1/processrequest') {
    const password = Buffer.from(SHORTCODE + PASSKEY + body.Timestamp).toString('base64');
    if (body.Password !== password) return send(400, { errorMessage: 'Wrong credentials' });
    fake.pushes++;
    const id = `ws_CO_TEST_${fake.pushes}`;
    fake.answers[id] = [...fake.defaultAnswers];
    return send(200, { MerchantRequestID: `m-${fake.pushes}`, CheckoutRequestID: id, ResponseCode: '0', ResponseDescription: 'Success' });
  }
  if (req.url === '/mpesa/stkpushquery/v1/query') {
    const answers = fake.answers[body.CheckoutRequestID];
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === 'processing') return send(500, { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' });
    if (answer === 'still') return send(200, { ResponseCode: '0', ResultCode: '4999', ResultDesc: 'The transaction is still under processing' });
    if (answer === 'cancelled') return send(200, { ResponseCode: '0', ResultCode: '1032', ResultDesc: 'Request cancelled by user' });
    if (answer === 'unknown') return send(500, { errorCode: '500.001.1001', errorMessage: 'The transaction does not exist' });
    return send(200, { ResponseCode: '0', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' });
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
process.env.MPESA_SHORTCODE = SHORTCODE;
process.env.MPESA_PASSKEY = PASSKEY;
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';
process.env.MPESA_QUERY_INTERVAL_MS = '0';
process.env.SEAT_BOOKING_CUTOFF = '23:59';
process.env.SEAT_BOOKING_OPENS = '00:00';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { reconcilePendingPayments } = await import('../src/services/payments.js');

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
const status = async (id) => (await db.get('SELECT status FROM mpesa_payments WHERE id = ?', id)).status;
const balance = async () => (await api('GET', '/passenger/wallet', { token: s.passenger })).body.balance;
/** Checks the payment like the app does, until it is no longer pending. */
async function waitForOutcome(id) {
  for (let i = 0; i < 10; i++) {
    const r = await api('GET', `/passenger/mpesa/${id}`, { token: s.passenger });
    if (r.body.payment.status !== 'pending') return r.body;
  }
  throw new Error('still pending');
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  const admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  const route = (await api('POST', '/admin/routes', {
    token: admin,
    body: { name: 'Thika Road', origin: 'Town', fare: 70, stops: [{ name: 'Juja' }, { name: 'Thika' }] },
  })).body;
  s.juja = route.stops[0];
  s.routeId = route.id;
  const vehicle = (await api('POST', '/admin/vehicles', {
    token: admin,
    body: { plate: 'KDA 123A', owner_name: 'Mary Owner', owner_phone: '0744555666', route_id: route.id },
  })).body;
  s.qr = `farepay://pay?v=${vehicle.qr_token}`;
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0712345678', password: 'Asecret1' })).body.token;
});
after(() => {
  server.close();
  daraja.close();
});

test('top-up: PIN prompt to the passenger, wallet credited only when M-Pesa confirms', async () => {
  const start = await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 200 } });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  assert.equal(start.body.payment.status, 'pending');
  const push = fake.requests.find((r) => r.path === '/mpesa/stkpush/v1/processrequest').body;
  assert.equal(push.PhoneNumber, '254712345678');
  assert.equal(push.Amount, 200);
  assert.match(push.CallBackURL, /\/hooks\/cbsecret\/stk$/);
  assert.doesNotMatch(push.CallBackURL, /mpesa|safaricom/i, 'Safaricom refuses addresses with these words');

  const first = await api('GET', `/passenger/mpesa/${start.body.payment.id}`, { token: s.passenger });
  assert.equal(first.body.payment.status, 'pending', 'passenger has not entered the PIN yet');
  assert.equal(first.body.wallet_balance, 0);

  const done = await waitForOutcome(start.body.payment.id);
  assert.equal(done.payment.status, 'completed');
  assert.equal(done.wallet_balance, 200);
  s.topupCheckout = start.body.payment.checkout_request_id;
});

test("Safaricom's later confirmation adds the receipt number without paying twice", async () => {
  const cb = await api('POST', '/hooks/cbsecret/stk', {
    body: {
      Body: {
        stkCallback: {
          CheckoutRequestID: s.topupCheckout,
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'SJK1234XYZ' }] },
        },
      },
    },
  });
  assert.equal(cb.body.ResultCode, 0);
  const txs = (await api('GET', '/passenger/wallet/transactions', { token: s.passenger })).body.items;
  assert.equal(txs.length, 1);
  assert.equal(txs[0].reference, 'SJK1234XYZ');
  assert.equal(await balance(), 200);
});

test('a callback with the wrong secret is ignored', async () => {
  for (const path of ['/hooks/wrong/stk', '/mpesa/callback/wrong/stk']) {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 404, path);
  }
});

test('top-up amounts outside the limits are refused before any prompt', async () => {
  const pushes = fake.pushes;
  assert.equal((await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 5 } })).status, 400);
  assert.equal(fake.pushes, pushes);
});

test('a cancelled prompt credits nothing', async () => {
  fake.defaultAnswers = ['cancelled'];
  const start = await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 50 } });
  const done = await waitForOutcome(start.body.payment.id);
  assert.equal(done.payment.status, 'failed');
  assert.match(done.payment.result_desc, /cancelled/i);
  assert.equal(await balance(), 200);
  fake.defaultAnswers = ['processing', 'paid'];
});

test('"still under processing" is not treated as a failure', async () => {
  fake.defaultAnswers = ['still', 'still', 'paid'];
  const start = await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 10 } });
  assert.equal((await api('GET', `/passenger/mpesa/${start.body.payment.id}`, { token: s.passenger })).body.payment.status, 'pending');
  assert.equal((await waitForOutcome(start.body.payment.id)).payment.status, 'completed');
  assert.equal(await balance(), 210);
  fake.defaultAnswers = ['processing', 'paid'];
});

test('wallet too low: the fare is paid by M-Pesa and the ticket is issued when M-Pesa confirms', async () => {
  // Spend the wallet down so it can't cover the KES 70 fare.
  for (let i = 0; i < 3; i++) {
    await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.qr, stop_id: s.juja.id, expected_fare: 70, idempotency_key: randomUUID() } });
  }
  assert.equal(await balance(), 0);

  const key = randomUUID();
  const start = await api('POST', '/passenger/pay-mpesa', { token: s.passenger, body: { qr: s.qr, stop_id: s.juja.id, expected_fare: 70, idempotency_key: key } });
  assert.equal(start.status, 202, JSON.stringify(start.body));
  assert.equal(start.body.payment.purpose, 'fare');
  assert.equal(fake.requests.filter((r) => r.path === '/mpesa/stkpush/v1/processrequest').at(-1).body.Amount, 70);

  const pushes = fake.pushes;
  const retry = await api('POST', '/passenger/pay-mpesa', { token: s.passenger, body: { qr: s.qr, stop_id: s.juja.id, expected_fare: 70, idempotency_key: key } });
  assert.equal(retry.body.payment.id, start.body.payment.id, 'tapping twice...');
  assert.equal(fake.pushes, pushes, '...does not send a second PIN prompt');

  const done = await waitForOutcome(start.body.payment.id);
  assert.equal(done.payment.status, 'completed');
  assert.ok(done.trip, 'ticket issued');
  assert.equal(done.trip.stop_name, 'Juja');
  assert.equal(done.trip.fare, 70);
  assert.equal(done.wallet_balance, 0, 'the M-Pesa money went straight to the fare');

  const txs = (await api('GET', '/passenger/wallet/transactions', { token: s.passenger })).body.items;
  assert.deepEqual(txs.slice(0, 2).map((t) => [t.type, t.amount]), [['fare', -70], ['topup', 70]]);

  const replay = await api('POST', '/passenger/pay-mpesa', { token: s.passenger, body: { qr: s.qr, stop_id: s.juja.id, expected_fare: 70, idempotency_key: key } });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.trip.ticket_code, done.trip.ticket_code);
});

test('a payment is confirmed in the background even if the app was closed', async () => {
  const start = await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 100 } });
  for (let i = 0; i < 5 && await status(start.body.payment.id) === 'pending'; i++) await reconcilePendingPayments();
  assert.equal(await status(start.body.payment.id), 'completed');
  assert.equal(await balance(), 100);
});

test('a prompt M-Pesa never answers expires without crediting anything', async () => {
  fake.defaultAnswers = ['unknown'];
  const start = await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 30 } });
  await reconcilePendingPayments();
  assert.equal(await status(start.body.payment.id), 'pending', 'not expired yet');
  await reconcilePendingPayments({ expireAfterMs: 0 });
  assert.equal(await status(start.body.payment.id), 'failed');
  assert.equal(await balance(), 100);
});

test('a prompt M-Pesa has no record of fails once past its PIN time, not after 15 minutes', async () => {
  fake.defaultAnswers = ['unknown'];
  const start = await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 30 } });
  const id = start.body.payment.id;
  assert.equal((await api('GET', `/passenger/mpesa/${id}`, { token: s.passenger })).body.payment.status, 'pending', 'still in its PIN time');
  await db.run('UPDATE mpesa_payments SET created_at = ? WHERE id = ?', new Date(Date.now() - 2 * 60_000).toISOString(), id);
  const seen = (await api('GET', `/passenger/mpesa/${id}`, { token: s.passenger })).body.payment;
  assert.equal(seen.status, 'failed', 'the app is told straight away');
  assert.match(seen.result_desc, /No answer from M-Pesa/);
  assert.equal(await balance(), 100);
  fake.defaultAnswers = ['processing', 'paid'];
});

test('a seat booking whose prompt M-Pesa never answers is released when the payment expires', async () => {
  fake.defaultAnswers = ['unknown'];
  const booked = await api('POST', '/book-api/seats', {
    body: { route_id: s.routeId, stop_id: s.juja.id, seats: 2, expected_fare: 70, phone: '0733444555', idempotency_key: randomUUID() },
  });
  assert.equal(booked.body.status, 'paying');
  await reconcilePendingPayments({ expireAfterMs: 0 });
  // Nobody opened the booking again: the background check alone must free it and tell the passenger.
  const row = await db.get("SELECT b.status, u.id AS user_id FROM seat_bookings b JOIN users u ON u.id = b.passenger_id WHERE b.code = ?", booked.body.code);
  assert.equal(row.status, 'failed');
  const told = await db.get("SELECT title, body FROM notifications WHERE user_id = ? AND kind = 'seat.failed'", row.user_id);
  assert.match(told.body, /No answer from M-Pesa\. No money was taken/);
  fake.defaultAnswers = ['processing', 'paid'];
});
