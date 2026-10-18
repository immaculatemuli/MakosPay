// Loyalty: every Nth paid ride is free for the passenger (here every 3rd, for a short test; 50th in real use).
// The car's owner is still paid the full fare: the SACCO covers it, and the money check proves it adds up.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.FREE_RIDE_EVERY = '3';
process.env.SEAT_BOOKING_CUTOFF = '23:59';
process.env.SEAT_BOOKING_OPENS = '00:00';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');

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
const login = async (phone, password) => (await api('POST', '/auth/login', { body: { phone, password } })).body.token;
const s = {};

async function passenger(phone) {
  const token = (await api('POST', '/auth/register', { body: { name: 'Pat', phone, password: 'pass123' } })).body.token;
  const userId = (await db.get('SELECT id FROM users WHERE phone = ?', `254${phone.slice(1)}`)).id;
  await tx(() => postWalletEntry(userId, { type: 'test_credit', amount: 2000 }));
  return { token, userId };
}
const balance = async (p) => (await db.get('SELECT balance FROM wallets WHERE user_id = ?', p.userId)).balance;
const ride = (p, how = 'pay') =>
  api('POST', `/passenger/${how}`, { token: p.token, body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: 100, idempotency_key: randomUUID() } });
const progress = async (p) => (await api('GET', '/passenger/summary', { token: p.token })).body.free_ride;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 120, app_fare: 100 }] } })).body;
  s.stop = s.route.stops[0];
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id } })).body;
  s.p = await passenger('0722000001');
});
after(() => server.close());

test('two paid rides, then the third is free: nothing taken, the owner still paid in full', async () => {
  assert.deepEqual(await progress(s.p), { every: 3, rides: 0, needed: 2, next_is_free: false, window_days: 90 });
  assert.equal((await ride(s.p)).status, 201);
  assert.equal((await ride(s.p)).status, 201);
  assert.equal(await balance(s.p), 1800);
  assert.equal((await progress(s.p)).next_is_free, true);
  const notes = (await api('GET', '/notifications', { token: s.p.token })).body.items;
  assert.ok(notes.some((n) => n.title === 'Your next ride is free'));

  const quote = (await api('GET', `/passenger/scan?qr=${s.vehicle.qr_token}&stop_id=${s.stop.id}`, { token: s.p.token })).body;
  assert.equal(quote.free_ride, true, 'the confirm screen says so');

  const free = await ride(s.p);
  assert.equal(free.status, 201);
  assert.equal(free.body.trip.free_ride, 1);
  assert.equal(free.body.trip.fare, 100, 'the owner is paid the full fare');
  assert.equal(await balance(s.p), 1800, 'nothing taken from the passenger');
  assert.equal((await progress(s.p)).rides, 0, 'counting starts again');
  assert.equal((await ride(s.p)).body.trip.free_ride, 0, 'the next one is paid');
  assert.equal(await balance(s.p), 1700);
});

test('with M-Pesa or without the app, a free ride needs no PIN prompt', async () => {
  await ride(s.p); // 2nd paid since the free one: the next is free
  const before = (await db.get('SELECT COUNT(*) AS n FROM mpesa_payments')).n;
  const r = await ride(s.p, 'pay-mpesa');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.trip.free_ride, 1);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM mpesa_payments')).n, before, 'no prompt sent');

  // A passenger without the app reaches their free ride on the pay page.
  const pay = (phone) =>
    api('POST', '/pay-api/pay', { body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: 100, phone, idempotency_key: randomUUID() } });
  await pay('0733000009');
  await pay('0733000009');
  const third = (await pay('0733000009')).body;
  assert.equal(third.status, 'paid');
  assert.equal(third.free_ride, true);
  assert.equal(third.ticket.free_ride, true);
});

test('a refunded free ride is not turned into money: the next ride is free again', async () => {
  await ride(s.p);
  await ride(s.p);
  const free = (await ride(s.p)).body.trip;
  assert.equal(free.free_ride, 1);
  const before = await balance(s.p);
  assert.equal((await api('POST', `/admin/payments/${free.id}/refund`, { token: s.admin, body: { reason: 'Car broke down' } })).status, 200);
  assert.equal(await balance(s.p), before, 'no cash for a free ride');
  assert.equal((await progress(s.p)).next_is_free, true);
  assert.equal((await ride(s.p)).body.trip.free_ride, 1);
});

test('refunded and old rides do not count', async () => {
  const q = await passenger('0722000002');
  const paid = (await ride(q)).body.trip;
  await api('POST', `/admin/payments/${paid.id}/refund`, { token: s.admin, body: { reason: 'Wrong car' } });
  assert.equal((await progress(q)).rides, 0, 'refunded');
  const old = (await ride(q)).body.trip;
  await db.run('UPDATE trips SET created_at = ? WHERE id = ?', new Date(Date.now() - 100 * 86_400_000).toISOString(), old.id);
  assert.equal((await progress(q)).rides, 0, 'older than 90 days');
});

test('a one-seat booking can be the free ride; cancelling it keeps the free ride', async () => {
  const q = await passenger('0722000003');
  await ride(q);
  await ride(q);
  const book = (seats) =>
    api('POST', '/passenger/seats', {
      token: q.token,
      body: { route_id: s.route.id, stop_id: s.stop.id, seats, expected_fare: 100, idempotency_key: randomUUID(), pay_with: 'mpesa' },
    });
  const two = (await book(2)).body;
  assert.equal(two.free_ride, false, 'a booking for two is paid');
  await api('POST', `/passenger/seats/${two.id}/cancel`, { token: q.token });

  const before = await balance(q);
  const one = (await book(1)).body;
  assert.equal(one.free_ride, true);
  assert.equal(one.status, 'queued', 'no prompt: queued at once');
  assert.equal((await progress(q)).next_is_free, false, 'the free ride is taken by the booking');
  const cancelled = (await api('POST', `/passenger/seats/${one.id}/cancel`, { token: q.token })).body;
  assert.equal(cancelled.refund_to, null, 'nothing paid back');
  assert.equal(await balance(q), before);
  assert.equal((await progress(q)).next_is_free, true, 'kept for the next ride');
});

test('the money check adds up, showing what the SACCO paid for free rides', async () => {
  const r = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(r.all_ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.totals.free_rides_paid_by_sacco >= 400);
});
