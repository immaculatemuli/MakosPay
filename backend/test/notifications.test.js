// Phase 6: in-app notifications (the bell) and the nightly money check alert.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db } = await import('../src/database.js');
const { handleStkCallback } = await import('../src/services/payments.js');
const { dailyPayoutRun } = await import('../src/services/payouts.js');
const { nightlyMoneyCheck } = await import('../src/services/reconciliation.js');
const { nairobiToday } = await import('../src/util.js');

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
const inbox = async (token) => (await api('GET', '/notifications', { token })).body;
const latest = async (token) => (await inbox(token)).items[0];

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  await createUser({ name: 'Second office', phone: '254700000002', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.admin2 = await login('0700000002', 'admin123');
  const route = (await api('POST', '/admin/routes', {
    token: s.admin,
    body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }] },
  })).body;
  s.route = route;
  s.ruiru = route.stops[0];
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: route.id } })).body;
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  s.other = (await api('POST', '/auth/register', { body: { name: 'Olive', phone: '0722333555', password: 'pass123' } })).body.token;
  s.passengerId = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
});
after(() => server.close());

test('a completed top-up tells the passenger the amount, receipt and new balance', async () => {
  assert.deepEqual((await api('GET', '/notifications/unread', { token: s.passenger })).body, { unread: 0 });
  assert.equal((await api('POST', '/passenger/wallet/topup', { token: s.passenger, body: { amount: 300 } })).status, 202);
  const n = await latest(s.passenger);
  assert.equal(n.kind, 'topup.completed');
  assert.equal(n.title, 'KES 300 added to your wallet');
  assert.match(n.body, /balance is now KES 300/);
  assert.equal(n.target, 'wallet');
  assert.equal(n.read_at, null);
  assert.equal((await inbox(s.passenger)).unread, 1);
});

test('a cancelled M-Pesa top-up is reported, with nothing taken', async () => {
  (await db.run("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, checkout_request_id) VALUES (?, '254722333444', 100, 'wallet', 'pending', 'ws_CO_test')", s.passengerId));
  await handleStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_test', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } });
  const n = await latest(s.passenger);
  assert.equal(n.kind, 'topup.failed');
  assert.match(n.body, /Request cancelled by user\. No money was taken/);
});

test('a refund tells the passenger why', async () => {
  const trip = (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: s.ruiru.id, expected_fare: 50, idempotency_key: randomUUID() } })).body.trip;
  s.trip = trip;
  await api('POST', `/admin/payments/${trip.id}/refund`, { token: s.admin, body: { reason: 'Charged twice' } });
  const n = await latest(s.passenger);
  assert.equal(n.title, 'KES 50 refunded to your wallet');
  assert.match(n.body, /Reason: Charged twice/);
});

test('a new report alerts every office account; the reply goes back to the passenger', async () => {
  const report = (await api('POST', '/passenger/reports', { token: s.passenger, body: { category: 'other', message: 'The conductor asked for cash' } })).body;
  for (const token of [s.admin, s.admin2]) {
    const n = await latest(token);
    assert.equal(n.kind, 'report.new');
    assert.equal(n.title, 'New problem report from passenger Pat');
    assert.equal(n.body, 'The conductor asked for cash');
  }
  await api('PATCH', `/admin/reports/${report.id}`, { token: s.admin, body: { status: 'resolved', office_note: 'We have spoken to the crew.' } });
  const n = await latest(s.passenger);
  assert.equal(n.title, 'The SACCO office replied to your report');
  assert.equal(n.body, 'We have spoken to the crew. (now resolved)');
});

test('a fare change reaches passengers who use the route, not others', async () => {
  const before = (await inbox(s.other)).items.length;
  await api('POST', `/admin/stops/${s.ruiru.id}/fare-change`, { token: s.admin, body: { cash_fare: 70, app_fare: 60, effective_date: nairobiToday() } });
  const n = await latest(s.passenger);
  assert.equal(n.kind, 'fare.changed');
  assert.equal(n.title, 'New fare to Ruiru (Thika Road)');
  assert.equal(n.body, 'FarePay fare KES 50 → KES 60 (cash KES 60 → KES 70), from today.');
  assert.equal((await inbox(s.other)).items.length, before, 'Olive never used this route');
});

test('reading: one, then all; nobody can read or mark anyone else’s', async () => {
  const mine = await inbox(s.passenger);
  assert.ok(mine.unread >= 4);
  const theirs = await latest(s.admin);
  assert.equal((await api('POST', '/notifications/read', { token: s.passenger, body: { id: theirs.id } })).body.unread, mine.unread, 'not mine: nothing changes');
  assert.equal((await latest(s.admin)).read_at, null);

  assert.equal((await api('POST', '/notifications/read', { token: s.passenger, body: { id: mine.items[0].id } })).body.unread, mine.unread - 1);
  assert.deepEqual((await api('POST', '/notifications/read', { token: s.passenger, body: {} })).body, { unread: 0 });
  assert.ok((await inbox(s.passenger)).items.every((n) => n.read_at));
  assert.ok((await inbox(s.passenger)).items.every((n) => n.kind !== 'report.new'), 'office alerts never go to passengers');
});

test('daily payouts tell the office what was sent', async () => {
  // The office may have paid during other tests: make sure something is owed.
  await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: s.ruiru.id, expected_fare: 60, idempotency_key: randomUUID() } });
  const paid = await dailyPayoutRun();
  assert.equal(paid.length, 1);
  const n = await latest(s.admin);
  assert.equal(n.kind, 'payout.daily');
  assert.equal(n.title, 'Daily payouts: 1 owner');
  assert.equal(n.body, '1 sent by M-Pesa (KES 60).');
  assert.equal(n.target, 'payouts');
});

test('the nightly money check is quiet when the books balance and alerts the office when not', async () => {
  const count = async () => (await inbox(s.admin)).items.length;
  const before = await count();
  assert.equal((await nightlyMoneyCheck()).all_ok, true);
  assert.equal(await count(), before, 'no alert when everything adds up');

  (await db.run('UPDATE wallets SET balance = balance + 1000 WHERE user_id = ?', s.passengerId));
  assert.equal((await nightlyMoneyCheck()).all_ok, false);
  const n = await latest(s.admin);
  assert.equal(n.kind, 'money_check.failed');
  assert.equal(n.title, 'Money check: 1 problem found');
  assert.match(n.body, /Every wallet balance matches its history/);
  assert.equal(n.target, 'money-check');
  assert.equal((await latest(s.admin2)).kind, 'money_check.failed');
  (await db.run('UPDATE wallets SET balance = balance - 1000 WHERE user_id = ?', s.passengerId));
});

test('signed-out people get nothing', async () => {
  assert.equal((await api('GET', '/notifications')).status, 401);
});
