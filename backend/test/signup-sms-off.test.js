// A server that can't send SMS (SMS_PROVIDER=off): new numbers sign up without a code, but a number that has paid
// without the app is never handed over, since nothing proves it belongs to whoever is signing up.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.SMS_PROVIDER = 'off';

const { createApp } = await import('../src/app.js');
const { passengerFor } = await import('../src/services/noapp.js');

let server;
let base;
const api = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('no SMS: the app is told no code is needed, and a new number signs up', async () => {
  const sent = await api('POST', '/auth/register/code', { phone: '0722200001' });
  assert.deepEqual(sent.body, { code_needed: false });
  const res = await api('POST', '/auth/register', { name: 'Pat', phone: '0722200001', password: 'pass1234' });
  assert.equal(res.status, 201);
});

test('no SMS: a number that paid without the app cannot be taken over', async () => {
  await passengerFor('254733200001');
  const res = await api('POST', '/auth/register', { name: 'Not Them', phone: '0733200001', password: 'pass1234' });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /Ask the SACCO office/);
});
