// Step 1: accounts. Passengers sign up; everyone logs in with phone + password and gets their role.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

const { createApp } = await import('../src/app.js');
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

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('a passenger signs up and is logged in straight away', async () => {
  const res = await signUp(api, { name: 'Pat Passenger', phone: '0722 222 222', password: 'Apass123' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'passenger');
  assert.equal(res.body.user.phone, '254722222222', 'phone stored in one standard format');
  assert.ok(res.body.token);

  const me = await api('GET', '/auth/me', { token: res.body.token });
  assert.equal(me.body.user.name, 'Pat Passenger');
});

test('the same phone number cannot sign up twice', async () => {
  const res = await signUp(api, { name: 'Again', phone: '+254722222222', password: 'Apass123' });
  assert.equal(res.status, 409);
});

test('bad sign-up details are refused with a clear message', async () => {
  const res = await signUp(api, { name: 'P', phone: '12345', password: '1' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), ['name', 'password', 'phone']);
});

test('a new password needs 8 characters, a capital letter, a small letter and a number', async () => {
  for (const weak of ['Abc1234', 'abcd1234', 'ABCD1234', 'Abcdefgh']) {
    const res = await signUp(api, { name: 'Weak Pass', phone: '0722555666', password: weak });
    assert.equal(res.status, 400, weak);
    assert.match(res.body.error.details[0].message, /at least 8 characters, with a capital letter, a small letter and a number/);
  }
  assert.equal((await signUp(api, { name: 'Strong Pass', phone: '0722555777', password: 'Abcd1234' })).status, 201);
});

test('every kind of user logs in with phone and password and gets their role', async () => {
  const people = [
    ['admin', '0700000001'],
    ['conductor', '0711000001'],
  ];
  for (const [role, phone] of people) {
    await createUser({ name: `Test ${role}`, phone: `254${phone.slice(1)}`, password: 'Asecret1', role });
    const res = await api('POST', '/auth/login', { body: { phone, password: 'Asecret1' } });
    assert.equal(res.status, 200, role);
    assert.equal(res.body.user.role, role);
  }
});

test('only the known user types exist', async () => {
  await assert.rejects(createUser({ name: 'Unknown Role', phone: '254711000009', password: 'Asecret1', role: 'owner' }));
});

test('wrong password and unknown numbers get the same answer', async () => {
  const wrong = await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'Anope123' } });
  const unknown = await api('POST', '/auth/login', { body: { phone: '0799999999', password: 'Anope123' } });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('a passenger can change their password', async () => {
  const { token } = (await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'Apass123' } })).body;
  const bad = await api('POST', '/auth/change-password', { token, body: { current_password: 'wrong', new_password: 'Anewpass1' } });
  assert.equal(bad.status, 400);
  const ok = await api('POST', '/auth/change-password', { token, body: { current_password: 'Apass123', new_password: 'Anewpass1' } });
  assert.equal(ok.status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'Anewpass1' } })).status, 200);
});

test('without logging in you cannot see account details', async () => {
  assert.equal((await api('GET', '/auth/me')).status, 401);
});
test('a passenger can fix their name; crew and office cannot change theirs', async () => {
  const token = (await signUp(api, { name: 'Jhon Typo', phone: '0722 999 001', password: 'Apass123' })).body.token;
  const res = await api('PATCH', '/auth/me', { token, body: { name: '  John Kamau ' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.name, 'John Kamau');
  assert.equal((await api('GET', '/auth/me', { token })).body.user.name, 'John Kamau');
  assert.equal((await api('PATCH', '/auth/me', { token, body: { name: 'J' } })).status, 400);

  const crew = (await api('POST', '/auth/login', { body: { phone: '0711000001', password: 'Asecret1' } })).body.token;
  assert.equal((await api('PATCH', '/auth/me', { token: crew, body: { name: 'Someone Else' } })).status, 403);
});
