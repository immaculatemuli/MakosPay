// The app asks on opening whether a newer APK is out; apps older than the minimum are told to update instead.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.APP_LATEST_VERSION = '1.1.0';
process.env.APP_MIN_VERSION = '1.1.0';

const { createApp } = await import('../src/app.js');
let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('anyone can see the newest app version, the oldest that works, and where to download it', async () => {
  const res = await fetch(`${base}/app-version`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.latest, '1.1.0');
  assert.equal(body.minimum, '1.1.0');
  assert.match(body.download_url, /FarePay\.apk$/);
});

test('an app older than the minimum is told to update; new apps, browsers and M-Pesa are not', async () => {
  const get = (headers) => fetch(`${base}/passenger/summary`, { headers });
  const old = await get({ 'User-Agent': 'okhttp/4.12.0' });
  assert.equal(old.status, 426, 'the APKs from before the version header');
  assert.match((await old.json()).error.message, /out of date.*Download the app/);
  assert.equal((await get({ 'User-Agent': 'okhttp/4.12.0', 'X-App-Version': '1.0.5' })).status, 426);
  assert.equal((await get({ 'User-Agent': 'okhttp/4.12.0', 'X-App-Version': '1.1.0' })).status, 401, 'up to date: on to signing in');
  assert.equal((await get({ 'User-Agent': 'Mozilla/5.0' })).status, 401, 'the office website in a browser');
  assert.equal((await fetch(`${base}/health`, { headers: { 'User-Agent': 'okhttp/4.12.0' } })).status, 200);
  assert.equal((await fetch(`${base}/app-version`, { headers: { 'User-Agent': 'okhttp/4.12.0' } })).status, 200);
});
