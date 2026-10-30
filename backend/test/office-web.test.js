// Step 7: the backend serves the built office dashboard at /office/ (same address as the API), with a
// content-security rule that only allows FarePay's own files; the API itself keeps its stricter rule.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// A stand-in for admin-web/dist, so this test doesn't depend on the dashboard having been built.
const dist = mkdtempSync(join(tmpdir(), 'farepay-office-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>FarePay office</title><div id="root"></div>');
writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("dashboard")');

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.OFFICE_WEB_DIR = dist;

const { createApp } = await import('../src/app.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('the dashboard page and its files are served at /office/ with their own security rule', async () => {
  const page = await fetch(`${base}/office/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /FarePay office/);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');

  const js = await fetch(`${base}/office/assets/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('deep links open the dashboard (it finds the screen itself); /office redirects to /office/', async () => {
  const deep = await fetch(`${base}/office/vehicles/3`);
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /FarePay office/);
  const bare = await fetch(`${base}/office`, { redirect: 'manual' });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), '/office/');
});

test('the API keeps its stricter rule, and the dashboard folder cannot be escaped', async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
  const escape = await fetch(`${base}/office/..%2f..%2fpackage.json`);
  assert.doesNotMatch(await escape.text(), /farepay-backend/);
});
