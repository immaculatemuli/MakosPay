// Seat booking from the passenger app: pay from the FarePay wallet at once, or by M-Pesa PIN prompt; see and
// cancel your own bookings.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';

const { createApp } = await import('../src/app.js');
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
  return { status: res.status, body: await res.json().catch(() => null) };
};
const s = {};
const book = (token, seats, payWith, key = randomUUID()) =>
  api('POST', '/passenger/bookings', { token, body: { route_id: s.route.id, stop_id: s.stop.id, seats, expected_fare: 200, idempotency_key: key, pay_with: payWith } });
const balance = async (token) => (await api('GET', '/passenger/wallet', { token })).body.balance;
const seatsLeft = async () => (await api('GET', '/crew/loading', { token: s.crew })).body.loading.seats_left;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Town', stops: [{ name: 'Machakos', fare: 200 }] } })).body;
  [s.stop] = s.route.stops;
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Conductor', phone: '0711000001', password: 'cond123' } })).body;
  await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KAP 001A', owner_name: 'Owner', owner_phone: '0744555666', seats: 6, conductor_id: c.id, route_id: s.route.id } });
  s.crew = (await api('POST', '/auth/login', { body: { phone: '0711000001', password: 'cond123' } })).body.token;
  s.pat = (await api('POST', '/auth/register', { body: { name: 'Pat App', phone: '0722000001', password: 'pass1234' } })).body.token;
  s.kim = (await api('POST', '/auth/register', { body: { name: 'Kim Other', phone: '0722000002', password: 'pass1234' } })).body.token;
  await api('POST', '/passenger/wallet/topup', { token: s.pat, body: { amount: 500 } }); // test M-Pesa confirms at once
  await api('POST', '/crew/loading/start', { token: s.crew });
});
after(() => server.close());

test('the app lists routes with the car loading and its seats', async () => {
  const routes = (await api('GET', '/passenger/booking-routes', { token: s.pat })).body;
  const r = routes.find((x) => x.id === s.route.id);
  assert.deepEqual(r.next_car, { plate: 'KAP 001A', seats_left: 6 });
  assert.deepEqual(r.stops, [{ id: s.stop.id, name: 'Machakos', fare: 200 }]);
});

test('booking 2 seats from the wallet: paid at once, no M-Pesa prompt', async () => {
  const res = await book(s.pat, 2, 'wallet');
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.status, res.body.amount, res.body.car.plate, res.body.wallet_balance], ['confirmed', 400, 'KAP 001A', 100]);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM mpesa_payments WHERE purpose = 'fare'")).n, 0, 'no PIN prompt');
  assert.equal(await seatsLeft(), 4);
  const crew = (await api('GET', '/crew/loading', { token: s.crew })).body;
  assert.equal(crew.bookings.find((b) => b.code === res.body.code).status, 'confirmed', 'the conductor sees it as paid');
  s.walletBooking = res.body;
});

test('the same booking sent twice is charged once', async () => {
  const key = randomUUID();
  await api('POST', '/passenger/wallet/topup', { token: s.pat, body: { amount: 200 } });
  const a = await book(s.pat, 1, 'wallet', key);
  const b = await book(s.pat, 1, 'wallet', key);
  assert.equal(a.body.code, b.body.code);
  assert.equal(await balance(s.pat), 100, '300 - 200 once');
  s.secondWallet = a.body;
});

test('a wallet that is short is refused, and holds no seat', async () => {
  const before = await seatsLeft();
  const res = await book(s.pat, 1, 'wallet');
  assert.equal(res.status, 402);
  assert.equal(res.body.error.code, 'INSUFFICIENT_FUNDS');
  assert.equal(await seatsLeft(), before);
});

test('or pay by M-Pesa PIN prompt to your own number', async () => {
  const res = await book(s.kim, 1, 'mpesa');
  assert.equal(res.body.status, 'confirmed');
  const payment = await db.get("SELECT phone, amount FROM mpesa_payments WHERE purpose = 'fare' ORDER BY id DESC LIMIT 1");
  assert.deepEqual([payment.phone, payment.amount], ['254722000002', 200]);
  s.kimBooking = res.body;
});

test('each passenger sees only their own bookings', async () => {
  const mine = (await api('GET', '/passenger/bookings', { token: s.pat })).body;
  assert.deepEqual(mine.map((b) => b.code).sort(), [s.walletBooking.code, s.secondWallet.code].sort());
  assert.equal((await api('GET', `/passenger/bookings/${s.walletBooking.id}`, { token: s.pat })).body.code, s.walletBooking.code);
  assert.equal((await api('GET', `/passenger/bookings/${s.walletBooking.id}`, { token: s.kim })).status, 404);
  assert.equal((await api('POST', `/passenger/bookings/${s.walletBooking.id}/cancel`, { token: s.kim })).status, 404);
});

test('cancelling a wallet booking puts the money back and frees the seats', async () => {
  const before = await seatsLeft();
  const res = await api('POST', `/passenger/bookings/${s.walletBooking.id}/cancel`, { token: s.pat });
  assert.equal(res.body.status, 'cancelled');
  assert.equal(await balance(s.pat), 500);
  assert.equal(await seatsLeft(), before + 2);
});

test('the money still adds up', async () => {
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});
