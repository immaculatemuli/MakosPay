// The "your car is coming" map: Google's tiles with a key (one shared session, renewed before it expires), else
// OpenStreetMap's; and the website lets the map's pictures load.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';

// A fake Google: counts the sessions it makes, and can be told to fail.
const google = { sessions: 0, fail: false, lastBody: null, lastKey: null };
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (req.method !== 'POST' || url.pathname !== '/v1/createSession') return res.writeHead(404).end();
    if (google.fail) return res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'API key not valid' } }));
    google.sessions += 1;
    google.lastBody = JSON.parse(body);
    google.lastKey = url.searchParams.get('key');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ session: `sess-${google.sessions}`, expiry: String(Math.floor(Date.now() / 1000) + 13 * 86400) }));
  });
});
await new Promise((resolve) => fake.listen(0, resolve));
process.env.GOOGLE_TILES_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

const { config } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');
const { forgetMapSession } = await import('../src/services/maps.js');

let server;
let base;
const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fake.close();
});

test('no Google key: OpenStreetMap', async () => {
  config.maps.googleKey = null;
  const res = await get('/book-api/map');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { provider: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', max_zoom: 19 });
});

test("with a key: Google's map, one session shared by everyone", async () => {
  config.maps.googleKey = 'test-key';
  forgetMapSession();
  const first = (await get('/book-api/map')).body;
  const second = (await get('/book-api/map')).body;
  assert.equal(first.provider, 'google');
  assert.equal(first.url, `${process.env.GOOGLE_TILES_BASE_URL}/v1/2dtiles/{z}/{x}/{y}?session=sess-1&key=test-key`);
  assert.equal(first.attribution, 'Map data © Google');
  assert.deepEqual(second, first);
  assert.equal(google.sessions, 1, 'not a new session per passenger');
  assert.equal(google.lastKey, 'test-key');
  assert.deepEqual(google.lastBody, { mapType: 'roadmap', language: 'en-KE', region: 'KE' });
});

test('Google refuses (wrong key, no billing): OpenStreetMap, so the map still shows', async () => {
  config.maps.googleKey = 'bad-key';
  forgetMapSession();
  google.fail = true;
  const res = (await get('/book-api/map')).body;
  assert.equal(res.provider, 'osm');
  google.fail = false;
});

test("the website allows Google's and OpenStreetMap's map pictures", async () => {
  const res = await fetch(`${base}/book.html`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /img-src 'self' data: https:\/\/tile\.googleapis\.com https:\/\/tile\.openstreetmap\.org;/);
  assert.match(csp, /script-src 'self';/, 'still no scripts from elsewhere');
});
