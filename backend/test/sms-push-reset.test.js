// SMS (Africa's Talking), push notifications (Expo) and "forgot password" by SMS code, against fake providers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

// Fake Africa's Talking and Expo push: they record what they were sent.
const sms = [];
const pushes = [];
let failNumber = null;
let unregistered = null;
const fake = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/version1/messaging') {
      const form = Object.fromEntries(new URLSearchParams(raw));
      sms.push({ apiKey: req.headers.apikey, ...form });
      const ok = form.to !== failNumber;
      return res.end(JSON.stringify({ SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: ok ? 101 : 403, number: form.to, status: ok ? 'Success' : 'InvalidPhoneNumber', messageId: 'ATXid_1' }] } }));
    }
    if (req.url === '/push') {
      const messages = JSON.parse(raw);
      pushes.push(...messages);
      return res.end(JSON.stringify({ data: messages.map((m) => (m.to === unregistered ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise((resolve) => fake.listen(0, resolve));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';
process.env.SMS_PROVIDER = 'africastalking';
process.env.AT_USERNAME = 'sandbox';
process.env.AT_API_KEY = 'at-test-key';
process.env.AT_BASE_URL = fakeBase;
process.env.EXPO_PUSH_URL = `${fakeBase}/push`;

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { flushSms } = await import('../src/services/sms.js');
const { flushPush } = await import('../src/services/push.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
/** Waits until fn() is true (texts and pushes go out in the background). */
async function until(fn, what) {
  for (let i = 0; i < 60; i++) {
    await flushSms();
    await flushPush();
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out: ${what}`);
}
const textsTo = (phone) => sms.filter((m) => m.to === phone);
const codeIn = (message) => message.match(/\b(\d{6})\b/)[1];
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  // Signing up: the code comes by SMS (a real SMS provider never shows it in the answer).
  const sent = await api('POST', '/auth/register/code', { body: { phone: '0722000001' } });
  assert.equal(sent.body.test_code, undefined);
  await until(() => textsTo('+254722000001').length === 1, 'the sign-up code SMS');
  assert.match(textsTo('+254722000001')[0].message, /Your FarePay sign-up code is \d{6}\. It works for 10 minutes\./);
  const code = codeIn(textsTo('+254722000001')[0].message);
  s.pat = (await api('POST', '/auth/register', { body: { name: 'Pat Passenger', phone: '0722000001', password: 'Aoldpass1', code } })).body.token;
  assert.ok(s.pat);
  sms.splice(0); // the tests below count only their own texts
});
after(() => {
  server.close();
  fake.close();
});

test('forgot password: a 6-digit code by SMS to the account number, never stored in the clear', async () => {
  const res = await api('POST', '/auth/password-reset/request', { body: { phone: '0722000001' } });
  assert.equal(res.status, 200);
  assert.match(res.body.message, /If this number has a FarePay account/);
  assert.equal(res.body.test_code, undefined, 'a real SMS provider: the code only goes by SMS');
  await until(() => textsTo('+254722000001').length === 1, 'the code SMS');
  const [text] = textsTo('+254722000001');
  assert.equal(text.apiKey, 'at-test-key');
  assert.equal(text.username, 'sandbox');
  assert.match(text.message, /Your FarePay code is \d{6}\. It works for 10 minutes\. Never share it/);
  s.code = codeIn(text.message);
  const row = await db.get("SELECT status, message, provider_message_id FROM sms_outbox WHERE kind = 'password_reset'");
  assert.deepEqual([row.status, row.message, row.provider_message_id], ['sent', null, 'ATXid_1'], 'the text (with the code) is removed once sent');
  const reset = await db.get('SELECT code_hash FROM password_resets');
  assert.ok(!reset.code_hash.includes(s.code), 'only a hash of the code is kept');
});

test('an unknown number gets the same answer, and no SMS', async () => {
  const before = sms.length;
  const res = await api('POST', '/auth/password-reset/request', { body: { phone: '0799999999' } });
  assert.match(res.body.message, /If this number has a FarePay account/);
  await new Promise((r) => setTimeout(r, 400));
  await flushSms();
  assert.equal(sms.length, before);
});

test('the right code sets a new password and signs out every other phone; the code works once', async () => {
  const wrong = await api('POST', '/auth/password-reset/confirm', { body: { phone: '0722000001', code: s.code === '000000' ? '111111' : '000000', new_password: 'Anewpass1' } });
  assert.equal(wrong.body.error.code, 'WRONG_CODE');
  assert.match(wrong.body.error.message, /4 tries left/);
  const ok = await api('POST', '/auth/password-reset/confirm', { body: { phone: '0722000001', code: s.code, new_password: 'Anewpass1' } });
  assert.deepEqual(ok.body, { ok: true });
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722000001', password: 'Anewpass1' } })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722000001', password: 'Aoldpass1' } })).status, 401);
  assert.equal((await api('GET', '/passenger/wallet', { token: s.pat })).status, 401, 'the old sign-in no longer works');
  const again = await api('POST', '/auth/password-reset/confirm', { body: { phone: '0722000001', code: s.code, new_password: 'Aanother1' } });
  assert.equal(again.body.error.code, 'NO_CODE');
  const log = await db.get("SELECT details FROM audit_log WHERE action = 'account.password_reset_by_sms'");
  assert.ok(log, 'in the audit log');
});

test('5 wrong codes stop the code; asking too often is stopped', async () => {
  await api('POST', '/auth/password-reset/request', { body: { phone: '0722000001' } });
  await until(() => textsTo('+254722000001').length === 2, 'second code');
  const code = codeIn(textsTo('+254722000001')[1].message);
  const bad = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await api('POST', '/auth/password-reset/confirm', { body: { phone: '0722000001', code: bad, new_password: 'Anewpass2' } });
  const blocked = await api('POST', '/auth/password-reset/confirm', { body: { phone: '0722000001', code, new_password: 'Anewpass2' } });
  assert.equal(blocked.body.error.code, 'TOO_MANY_TRIES', 'even the right code, after 5 wrong ones');
  assert.equal((await api('POST', '/auth/password-reset/request', { body: { phone: '0722000001' } })).status, 200, 'third request this hour');
  assert.equal((await api('POST', '/auth/password-reset/request', { body: { phone: '0722000001' } })).status, 429, 'fourth is refused');
});

test('a passenger who only paid without the app can set a first password by SMS', async () => {
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Route', origin: 'Town', stops: [{ name: 'Stop', fare: 50 }] } })).body;
  const v = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KSM 001S', owner_name: 'Owner', owner_phone: '0744555666', route_id: route.id } })).body;
  const paid = await api('POST', '/pay-api/pay', { body: { qr: v.qr_token, stop_id: route.stops[0].id, expected_fare: 50, phone: '0733000009', idempotency_key: 'noapp-key-1' } });
  assert.equal(paid.status, 202, JSON.stringify(paid.body));
  await api('POST', '/auth/password-reset/request', { body: { phone: '0733000009' } });
  await until(() => textsTo('+254733000009').length === 1, 'code to the no-app passenger');
  const code = codeIn(textsTo('+254733000009')[0].message);
  await api('POST', '/auth/password-reset/confirm', { body: { phone: '0733000009', code, new_password: 'Afirst123' } });
  const login = await api('POST', '/auth/login', { body: { phone: '0733000009', password: 'Afirst123' } });
  assert.equal(login.status, 200);
  assert.equal((await api('GET', '/passenger/trips', { token: login.body.token })).body.items.length, 1, 'their fare is in their account');
  s.route = route;
});

test('parcels: the receiver gets the tracking code and collection code, the sender a receipt, then "arrived"', async () => {
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Conductor', phone: '0711000001', password: 'Acond123' } })).body;
  await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KSM 002S', owner_name: 'Owner', owner_phone: '0744555666', conductor_id: c.id, route_id: s.route.id } });
  const crew = (await api('POST', '/auth/login', { body: { phone: '0711000001', password: 'Acond123' } })).body.token;
  const p = (await api('POST', '/admin/parcels', {
    token: s.admin,
    body: { sender_name: 'Sam Sender', sender_phone: '0722111222', receiver_name: 'Mary Wanjiku', receiver_phone: '0733222111', route_id: s.route.id, stop_id: s.route.stops[0].id, fee: 300, payment: 'cash' },
  })).body;
  await until(() => textsTo('+254733222111').length === 1 && textsTo('+254722111222').length === 1, 'parcel texts');
  const receiver = textsTo('+254733222111')[0].message;
  assert.ok(receiver.includes(p.tracking_code) && receiver.includes(p.collection_code) && receiver.includes('from Sam S.'), receiver);
  const sender = textsTo('+254722111222')[0].message;
  assert.ok(sender.includes(p.tracking_code) && !sender.includes(p.collection_code), 'the sender is not sent the collection code');

  await api('POST', '/crew/loading/start', { token: crew });
  await api('POST', `/crew/parcels/${p.id}/load`, { token: crew });
  await api('POST', '/crew/loading/depart', { token: crew });
  await api('POST', `/crew/road/stops/${s.route.stops[0].id}`, { token: crew });
  await until(() => textsTo('+254733222111').length === 2, 'arrived text');
  assert.match(textsTo('+254733222111')[1].message, /is at Stop\. Collect it with your 6-digit collection code/);
});

test('a text Africa\'s Talking refuses is tried 3 times, then given up (and its text removed)', async () => {
  failNumber = '+254722999888';
  await createUser({ name: 'Bad Number', phone: '254722999888', password: 'Apass1234', role: 'passenger' });
  await api('POST', '/auth/password-reset/request', { body: { phone: '0722999888' } });
  await until(async () => (await db.get("SELECT status FROM sms_outbox WHERE phone = '254722999888'"))?.status === 'failed', 'given up');
  const row = await db.get("SELECT attempts, message, error FROM sms_outbox WHERE phone = '254722999888'");
  assert.deepEqual([row.attempts, row.message, row.error], [3, null, 'InvalidPhoneNumber']);
});

test('push: a phone registers, gets each new notification, and is forgotten once it stops accepting', async () => {
  const token = (await api('POST', '/auth/login', { body: { phone: '0722000001', password: 'Anewpass1' } })).body.token;
  assert.equal((await api('POST', '/notifications/push-token', { token, body: { token: 'not-a-token-at-all' } })).status, 400);
  assert.equal((await api('POST', '/notifications/push-token', { token, body: { token: 'ExponentPushToken[abcdefghij123]' } })).status, 200);
  await api('POST', '/passenger/wallet/topup', { token, body: { amount: 100 } }); // test M-Pesa confirms: "KES 100 added to your wallet"
  await until(() => pushes.some((m) => m.to === 'ExponentPushToken[abcdefghij123]' && /added to your wallet/.test(m.title)), 'the push');
  const pushed = pushes.find((m) => /added to your wallet/.test(m.title));
  assert.equal(pushed.data.target, 'wallet');
  const count = pushes.length;
  await flushPush();
  assert.equal(pushes.length, count, 'each notification is pushed once');

  unregistered = 'ExponentPushToken[abcdefghij123]';
  await api('POST', '/passenger/wallet/topup', { token, body: { amount: 50 } });
  await until(async () => !(await db.get('SELECT 1 FROM push_tokens')), 'the token forgotten');

  await api('POST', '/notifications/push-token', { token, body: { token: 'ExponentPushToken[zzzzzzzzzz999]' } });
  await api('POST', '/notifications/push-token/remove', { token, body: { token: 'ExponentPushToken[zzzzzzzzzz999]' } });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_tokens')).n, 0, 'removed on sign-out');
});
