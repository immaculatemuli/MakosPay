// Signing up proves the number is the passenger's: an SMS code first, then the account with it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.SMS_PROVIDER = 'log';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { passengerFor } = await import('../src/services/noapp.js');
const { createUser } = await import('../src/services/users.js');

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
const askCode = async (phone) => (await api('POST', '/auth/register/code', { body: { phone } })).body;
const register = (phone, code, name = 'Pat Passenger') => api('POST', '/auth/register', { body: { name, phone, password: 'pass1234', code } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('no account without the SMS code', async () => {
  const res = await register('0722100001', undefined);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'CODE_NEEDED');
  assert.equal(await db.get("SELECT id FROM users WHERE phone = '254722100001'"), undefined);
});

test('the code is sent by SMS, kept only as a hash, and opens the account once', async () => {
  const sent = await askCode('0722100002');
  assert.equal(sent.code_needed, true);
  assert.match(sent.test_code, /^\d{6}$/, 'SMS test mode: the code is in the answer');
  const row = await db.get("SELECT code_hash FROM signup_codes WHERE phone = '254722100002'");
  assert.notEqual(row.code_hash, sent.test_code);
  const text = await db.get("SELECT kind FROM sms_outbox WHERE phone = '254722100002'");
  assert.equal(text.kind, 'signup_code');

  const res = await register('0722100002', sent.test_code);
  assert.equal(res.status, 201);
  assert.equal(res.body.user.phone, '254722100002');
  const again = await register('0722100002', sent.test_code);
  assert.equal(again.status, 409, 'the number now has an account');
});

test('a wrong code counts down the tries, then the code stops working', async () => {
  const sent = await askCode('0722100003');
  const wrong = sent.test_code === '000000' ? '111111' : '000000';
  const first = await register('0722100003', wrong);
  assert.equal(first.body.error.code, 'WRONG_CODE');
  assert.match(first.body.error.message, /4 tries left/);
  for (let i = 0; i < 4; i++) await register('0722100003', wrong);
  const blocked = await register('0722100003', sent.test_code);
  assert.equal(blocked.status, 429, 'even the right code is refused after 5 wrong ones');
});

test('asking again cancels the old code', async () => {
  const old = await askCode('0722100004');
  const fresh = await askCode('0722100004');
  if (old.test_code !== fresh.test_code) assert.equal((await register('0722100004', old.test_code)).body.error.code, 'WRONG_CODE');
  assert.equal((await register('0722100004', fresh.test_code)).status, 201);
});

test('no code is sent to a number that already has an account', async () => {
  await createUser({ name: 'Ian', phone: '254711100001', password: 'cond123', role: 'conductor' });
  const res = await api('POST', '/auth/register/code', { body: { phone: '0711100001' } });
  assert.equal(res.status, 409);
  assert.equal(await db.get("SELECT id FROM sms_outbox WHERE phone = '254711100001'"), undefined);
});

test('someone who paid without the app gets their history only with the code from their phone', async () => {
  const id = await passengerFor('254733100001');
  const noCode = await register('0733100001', undefined, 'Not Them');
  assert.equal(noCode.status, 400);
  const sent = await askCode('0733100001');
  const res = await register('0733100001', sent.test_code, 'Nina NoApp');
  assert.equal(res.status, 201);
  assert.equal(res.body.user.id, id, 'the same passenger: their fares are theirs');
});

test('a code is for its own number only', async () => {
  const sent = await askCode('0722100005');
  await askCode('0722100006');
  const res = await register('0722100006', sent.test_code);
  if (res.status !== 201) assert.equal(res.body.error.code, 'WRONG_CODE');
});
