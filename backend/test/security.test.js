// Phase 8: limits on repeated attempts, signing out old sessions, security headers, backups, production checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { BACKUP_EXTENSION: ext, backupNow } = await import('../src/services/backup.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
};
const login = (phone, password) => api('POST', '/auth/login', { body: { phone, password } });
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await login('0700000001', 'admin123')).body.token;
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body;
});
after(() => server.close());

test('5 wrong passwords lock that number for a while, even with the right password; other numbers still work', async () => {
  await createUser({ name: 'Target', phone: '254711000001', password: 'right123', role: 'passenger' });
  for (let i = 0; i < 5; i++) assert.equal((await login('0711000001', `wrong${i}`)).body.error.code, 'INVALID_CREDENTIALS');
  const locked = await login('0711000001', 'right123');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.equal((await login('0700000001', 'admin123')).status, 200, 'other accounts are not affected');
});

test('signing in correctly clears the count, so the odd typo never locks anyone out', async () => {
  await createUser({ name: 'Typo', phone: '254711000002', password: 'right123', role: 'passenger' });
  for (let i = 0; i < 4; i++) await login('0711000002', 'oops');
  assert.equal((await login('0711000002', 'right123')).status, 200);
  for (let i = 0; i < 4; i++) await login('0711000002', 'oops');
  assert.equal((await login('0711000002', 'right123')).status, 200);
});

test('a wrong number and a wrong password get the same answer', async () => {
  const unknown = await login('0799999999', 'whatever');
  const wrong = await login('0722333444', 'whatever');
  assert.deepEqual([unknown.status, unknown.body.error], [wrong.status, wrong.body.error]);
});

test('changing the password signs out other phones but keeps this one signed in', async () => {
  const other = (await login('0722333444', 'pass123')).body.token;
  const r = await api('POST', '/auth/change-password', { token: s.passenger.token, body: { current_password: 'pass123', new_password: 'newpass456' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token, 'a fresh sign-in for this phone');
  assert.equal((await api('GET', '/auth/me', { token: r.body.token })).status, 200);
  const old = await api('GET', '/auth/me', { token: other });
  assert.equal(old.status, 401);
  assert.match(old.body.error.message, /password was changed/);
  assert.equal((await api('GET', '/auth/me', { token: s.passenger.token })).status, 401, 'the token used to change it is replaced too');
  s.passengerToken = r.body.token;
});

test('an office password reset signs the person out everywhere', async () => {
  const id = s.passenger.user.id;
  assert.equal((await api('POST', `/admin/users/${id}/password`, { token: s.admin, body: { new_password: 'office789' } })).status, 200);
  assert.equal((await api('GET', '/auth/me', { token: s.passengerToken })).status, 401);
  s.passengerToken = (await login('0722333444', 'office789')).body.token;
  assert.equal((await api('GET', '/passenger/wallet', { token: s.passengerToken })).status, 200);
});

test('M-Pesa PIN prompts are limited per passenger (10 per 10 minutes)', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await api('POST', '/passenger/wallet/topup', { token: s.passengerToken, body: { amount: 10 } })).status, 202, `prompt ${i + 1}`);
  }
  const r = await api('POST', '/passenger/wallet/topup', { token: s.passengerToken, body: { amount: 10 } });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'TOO_MANY_ATTEMPTS');
});

test('responses are never cached and carry security headers; health checks the database', async () => {
  const r = await api('GET', '/health');
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('too-large requests are refused politely', async () => {
  const r = await api('POST', '/auth/login', { body: { phone: '0722333444', password: 'x'.repeat(200_000) } });
  assert.equal(r.status, 413);
  assert.equal(r.body.error.code, 'TOO_LARGE');
});

test('backups: a full copy per day, only the newest kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farepay-backup-'));
  for (const old of ['2026-01-01', '2026-01-02', '2026-01-03']) writeFileSync(join(dir, `farepay-${old}.${ext}`), 'old');
  writeFileSync(join(dir, 'notes.txt'), 'not a backup');
  const { file, bytes, removed } = await backupNow(dir, 2, '2026-01-04');
  assert.ok(existsSync(file));
  assert.ok(bytes > 1000, 'a real database file');
  assert.deepEqual(removed, [`farepay-2026-01-01.${ext}`, `farepay-2026-01-02.${ext}`]);
  assert.deepEqual(readdirSync(dir).sort(), [`farepay-2026-01-03.${ext}`, `farepay-2026-01-04.${ext}`, 'notes.txt']);
  await backupNow(dir, 2, '2026-01-04'); // running twice on one day replaces that day's file
});

test('the server refuses to start in production with weak settings, and real money needs production', async () => {
  const start = (env) =>
    spawnSync(process.execPath, ['-e', "import('./src/config.js').then(() => console.log('started'))"], {
      cwd: join(import.meta.dirname, '..'),
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });
  const strong = { JWT_SECRET: 'x'.repeat(40), MPESA_CALLBACK_SECRET: 'y'.repeat(30), USSD_SECRET: 'u'.repeat(30), MPESA_CALLBACK_BASE_URL: 'https://api.example.co.ke', DB_PATH: './data/test-never-created.db' };
  assert.match(start({ NODE_ENV: 'production', ...strong, JWT_SECRET: 'short' }).stderr, /JWT_SECRET must be set/);
  assert.match(start({ NODE_ENV: 'production', ...strong, MPESA_CALLBACK_SECRET: 'abc' }).stderr, /MPESA_CALLBACK_SECRET/);
  assert.match(start({ NODE_ENV: 'production', ...strong, MPESA_CALLBACK_BASE_URL: 'http://plain.example' }).stderr, /https/);
  assert.match(start({ NODE_ENV: 'production', ...strong, USSD_SECRET: 'short' }).stderr, /USSD_SECRET/);
  assert.match(start({ ...strong, MPESA_MODE: 'production' }).stderr, /needs NODE_ENV=production/);
  assert.match(start({ NODE_ENV: 'production', ...strong, MPESA_MODE: 'production' }).stdout, /started/);
});
