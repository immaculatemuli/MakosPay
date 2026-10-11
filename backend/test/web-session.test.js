// Step 6: the office web dashboard signs in with an HttpOnly cookie, is protected against forged requests
// from other websites, and gets no CORS permission. The phone app's sign-in is unchanged.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');

let server;
let base;
const WEB = { 'x-farepay-client': 'office-web' };
const request = async (method, path, { headers = {}, body } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};
const cookieFrom = (res) => res.headers.getSetCookie().find((c) => c.startsWith('farepay_office='));
const asCookie = (setCookie) => setCookie.split(';')[0];
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  await createUser({ name: 'Ian', phone: '254711000001', password: 'cond123', role: 'conductor' });
  await request('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } });
});
after(() => server.close());

test('the office signs in on the web: an HttpOnly, SameSite=Strict cookie for 12 hours, and no token in the answer', async () => {
  const r = await request('POST', '/auth/web/login', { headers: WEB, body: { phone: '0700000001', password: 'admin123' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'admin');
  assert.equal(r.body.token, undefined, 'page scripts never see the sign-in');
  const set = cookieFrom(r);
  assert.match(set, /; HttpOnly/);
  assert.match(set, /; SameSite=Strict/);
  assert.match(set, /; Max-Age=43200/);
  assert.match(set, /; Path=\//);
  s.cookie = asCookie(set);
});

test('the cookie opens the office screens (reading needs nothing else)', async () => {
  assert.equal((await request('GET', '/auth/me', { headers: { cookie: s.cookie } })).body.user.name, 'Office');
  assert.equal((await request('GET', '/admin/summary', { headers: { cookie: s.cookie } })).status, 200);
});

test('changes with the cookie need the dashboard header and our own origin (no forged requests)', async () => {
  const route = { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }] };
  const noHeader = await request('POST', '/admin/routes', { headers: { cookie: s.cookie }, body: route });
  assert.equal(noHeader.status, 403);
  assert.equal(noHeader.body.error.code, 'WEB_HEADER_MISSING');
  const otherSite = await request('POST', '/admin/routes', { headers: { cookie: s.cookie, ...WEB, origin: 'https://evil.example' }, body: route });
  assert.equal(otherSite.status, 403);
  assert.equal(otherSite.body.error.code, 'WRONG_ORIGIN');
  const ok = await request('POST', '/admin/routes', { headers: { cookie: s.cookie, ...WEB, origin: base }, body: route });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await request('GET', '/admin/routes', { headers: { cookie: s.cookie } })).body.length, 1, 'nothing was created by the refused requests');
});

test('the web dashboard is for the office only; passengers and crew use the app', async () => {
  for (const [phone, password] of [['0722333444', 'pass123'], ['0711000001', 'cond123']]) {
    const r = await request('POST', '/auth/web/login', { headers: WEB, body: { phone, password } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'OFFICE_ONLY');
    assert.equal(cookieFrom(r), undefined, 'no cookie is given');
  }
});

test('web sign-in also needs the dashboard header, and counts wrong passwords like the app', async () => {
  assert.equal((await request('POST', '/auth/web/login', { body: { phone: '0700000001', password: 'admin123' } })).status, 403);
  const wrong = await request('POST', '/auth/web/login', { headers: WEB, body: { phone: '0700000001', password: 'nope' } });
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
});

test('a web sign-in only works as the cookie, and a phone sign-in only as a bearer token', async () => {
  const webToken = decodeURIComponent(s.cookie.split('=')[1]);
  assert.equal((await request('GET', '/auth/me', { headers: { authorization: `Bearer ${webToken}` } })).status, 401);
  const app = await request('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } });
  assert.ok(app.body.token, 'the phone app still gets its token');
  assert.equal((await request('GET', '/auth/me', { headers: { cookie: `farepay_office=${app.body.token}` } })).status, 401);
  assert.equal((await request('GET', '/auth/me', { headers: { authorization: `Bearer ${app.body.token}` } })).status, 200);
});

test('no other website gets permission to call the API (no CORS headers, even when asked)', async () => {
  const preflight = await fetch(`${base}/admin/summary`, {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-farepay-client' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  const get = await request('GET', '/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(get.headers.get('access-control-allow-origin'), null);
});

test('changing the password on the web keeps this browser signed in and signs out the old cookie', async () => {
  const r = await request('POST', '/auth/change-password', { headers: { cookie: s.cookie, ...WEB }, body: { current_password: 'admin123', new_password: 'admin456' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, undefined);
  const fresh = asCookie(cookieFrom(r));
  assert.equal((await request('GET', '/auth/me', { headers: { cookie: s.cookie } })).status, 401, 'the old cookie no longer works');
  assert.equal((await request('GET', '/auth/me', { headers: { cookie: fresh } })).status, 200);
  s.cookie = fresh;
});

test('signing out clears the cookie', async () => {
  const r = await request('POST', '/auth/web/logout', { headers: { cookie: s.cookie, ...WEB } });
  assert.equal(r.status, 200);
  assert.match(cookieFrom(r), /^farepay_office=; .*Max-Age=0/);
});
