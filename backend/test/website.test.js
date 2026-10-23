// The public website (website/) is served at the main address, after every API address.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

const { createApp } = await import('../src/app.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('the home page, privacy policy and their files are served with a strict content policy', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /Pay your Makos fare/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(home.headers.get('content-security-policy'), /unsafe-inline/);
  for (const path of ['/privacy.html', '/site.css', '/site.js', '/favicon.svg']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

test('the website never hides the API or the other pages', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
  assert.equal((await fetch(`${base}/passenger/wallet`)).status, 401, 'API still asks for a sign-in');
  const missing = await fetch(`${base}/no-such-page`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  assert.equal((await fetch(`${base}/pay`)).status, 200, 'the pay page');
  assert.equal((await fetch(`${base}/../backend/.env`)).status, 404, 'nothing outside the website folder');
});

test('the short link /app opens the page to download the app', async () => {
  for (const path of ['/app', '/app.html']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /Get the FarePay app/);
    assert.match(html, /href="https:\/\/github\.com\/[\w-]+\/[\w-]+\/releases\/latest\/download\/FarePay\.apk"/, 'the newest release\'s APK');
  }
});
