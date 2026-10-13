// Paying without the app: the sticker is a link that any phone camera opens; the pay page sends the M-Pesa
// PIN prompt and the fare is recorded like an app passenger's (ticket, conductor's list, payout, money check).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';
process.env.MPESA_CALLBACK_BASE_URL = 'https://fare.example.co.ke/';

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');

let server;
let base;
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};
const s = {};
const payPage = (phone, { stopId = s.juja.id, fare = 70, key = randomUUID() } = {}) =>
  api('POST', '/pay-api/pay', { body: { qr: s.token, stop_id: stopId, expected_fare: fare, phone, idempotency_key: key } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }, { name: 'Juja', cash_fare: 80, app_fare: 70 }] },
  })).body;
  [s.ruiru, s.juja] = s.route.stops;
  await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian Conductor', phone: '0711111111', password: 'cond123' } });
  const conductorId = (await db.get("SELECT id FROM users WHERE phone = '254711111111'")).id;
  s.vehicle = (await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: { plate: 'KDA 123A', description: 'White Nissan', owner_name: 'Mary Owner', owner_phone: '0744555666', conductor_id: conductorId, route_id: s.route.id },
  })).body;
  s.token = s.vehicle.qr_token;
  s.conductor = (await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } })).body.token;
});
after(() => server.close());

test('with the server address set, the sticker is a link to the pay page', async () => {
  assert.equal(config.qrPrefix, 'https://fare.example.co.ke/pay?v=');
  const qr = (await api('GET', `/admin/vehicles/${s.vehicle.id}/qr`, { token: s.admin })).body;
  assert.equal(qr.opens_with_camera, true);
});

test('the pay page and its files are served with a strict content policy', async () => {
  const page = await fetch(`${base}/pay?v=${s.token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Pay with M-Pesa/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const file of ['pay.js', 'pay.css']) assert.equal((await fetch(`${base}/pay-assets/${file}`)).status, 200, file);
  assert.equal((await fetch(`${base}/pay-assets/../services/noapp.js`)).status, 404, 'nothing outside the page folder');
});

test('the page shows the vehicle, route and member fares, and nothing private', async () => {
  const { status, body } = await api('GET', `/pay-api/vehicle?qr=${s.token}`);
  assert.equal(status, 200);
  assert.equal(body.vehicle.plate, 'KDA 123A');
  assert.deepEqual(body.route.stops.map((x) => `${x.name} ${x.fare}`), ['Ruiru 50', 'Juja 70']);
  const text = JSON.stringify(body);
  for (const secret of ['744555666', 'Mary Owner', s.token, 'Ian']) assert.ok(!text.includes(secret), `does not show ${secret}`);
  assert.equal((await api('GET', '/pay-api/vehicle?qr=not-a-sticker')).body.error.code, 'INVALID_QR');
});

test('a passenger without the app pays: PIN prompt, ticket, and the conductor sees it', async () => {
  const res = await payPage('0733 000 111');
  assert.equal(res.status, 202);
  assert.equal(res.body.status, 'paid'); // the test M-Pesa confirms at once
  assert.equal(res.body.ticket.plate, 'KDA 123A');
  assert.equal(res.body.ticket.stop_name, 'Juja');
  assert.equal(res.body.ticket.fare, 70);
  s.ticket = res.body.ticket.code;
  s.statusToken = res.body.status_token;

  const again = await api('GET', `/pay-api/payment/${encodeURIComponent(s.statusToken)}`);
  assert.equal(again.body.ticket.code, s.ticket);

  const crew = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.ok(crew.payments.some((p) => p.ticket_code === s.ticket), 'on the conductor list');
  assert.equal((await api('GET', `/crew/tickets/${s.ticket}`, { token: s.conductor })).status, 200, 'the conductor can check the ticket');

  const passenger = await db.get("SELECT * FROM users WHERE phone = '254733000111'");
  assert.equal(passenger.role, 'passenger');
  assert.equal((await db.get('SELECT balance FROM wallets WHERE user_id = ?', passenger.id)).balance, 0, 'paid in, straight out for the fare');
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});

test('nobody can sign in as a passenger who paid without the app', async () => {
  for (const password of ['no-app-passenger', '', 'anything']) {
    const res = await api('POST', '/auth/login', { body: { phone: '0733000111', password } });
    assert.notEqual(res.status, 200, `password ${JSON.stringify(password)}`);
  }
});

test('the status link is not a sign-in, and a changed one does not work', async () => {
  assert.equal((await api('GET', '/passenger/wallet', { token: s.statusToken })).status, 401);
  assert.equal((await api('GET', `/pay-api/payment/${encodeURIComponent(`${s.statusToken}x`)}`)).status, 404);
});

test('signing up in the app with that number takes over the fares paid without the app', async () => {
  const res = await api('POST', '/auth/register', { body: { name: 'Nina NoApp', phone: '0733000111', password: 'pass1234' } });
  assert.equal(res.status, 201);
  const trips = (await api('GET', '/passenger/trips', { token: res.body.token })).body.items;
  assert.deepEqual(trips.map((t) => t.ticket_code), [s.ticket]);
  // ...and once it has a password, nobody else can sign up with it.
  const twice = await api('POST', '/auth/register', { body: { name: 'Someone', phone: '0733000111', password: 'other123' } });
  assert.equal(twice.body.error.code, 'PHONE_TAKEN');
});

test('an app passenger who pays from the page gets the ticket in their app', async () => {
  const token = (await api('POST', '/auth/register', { body: { name: 'Pat App', phone: '0722222222', password: 'pass123' } })).body.token;
  const res = await payPage('0722222222', { stopId: s.ruiru.id, fare: 50 });
  assert.equal(res.body.status, 'paid');
  const trips = (await api('GET', '/passenger/trips', { token })).body.items;
  assert.equal(trips[0].ticket_code, res.body.ticket.code);
});

test('the page refuses staff numbers, changed fares and bad phone numbers', async () => {
  assert.equal((await payPage('0711111111')).body.error.code, 'NOT_A_PASSENGER_NUMBER');
  const changed = await payPage('0733000222', { fare: 60 });
  assert.equal(changed.body.error.code, 'FARE_CHANGED');
  assert.equal(changed.body.error.details.fare, 70);
  assert.equal((await payPage('0733000222')).status, 202, 'the right fare still works');
  assert.equal((await payPage('12345')).body.error.code, 'VALIDATION_ERROR');
});

test('PIN prompts from the page are limited per phone number', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await payPage('0733000999')).status);
  assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
});

test('the in-app scanner also accepts the link sticker', async () => {
  const token = (await api('POST', '/auth/login', { body: { phone: '0722222222', password: 'pass123' } })).body.token;
  const res = await api('GET', `/passenger/scan?qr=${encodeURIComponent(`https://fare.example.co.ke/pay?v=${s.token}`)}&stop_id=${s.juja.id}`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.vehicle.plate, 'KDA 123A');
});

test('one fare per stop: routes and fare changes take { fare }, and every screen gets that one fare', async () => {
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'One Fare Road', origin: 'Town', stops: [{ name: 'Kitengela', fare: 120 }] } })).body;
  const [stop] = route.stops;
  assert.deepEqual([stop.fare, stop.app_fare, stop.cash_fare, stop.you_save], [120, 120, 120, 0]);
  const change = await api('POST', `/admin/stops/${stop.id}/fare-change`, { token: s.admin, body: { fare: 130, effective_date: new Date().toISOString().slice(0, 10) } });
  assert.equal(change.status, 201);
  const after = (await api('GET', `/admin/routes/${route.id}`, { token: s.admin })).body.stops[0];
  assert.deepEqual([after.fare, after.app_fare, after.cash_fare], [130, 130, 130]);
  assert.equal((await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Bad', origin: 'Town', stops: [{ name: 'X1', fare: 0 }] } })).status, 400);
});
