// How FarePay runs with the office paying owners by hand and no SMS: the driver's tap releases the fares, the evening
// run makes one payout per owner for all their cars, and nothing waits for a text.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'sandbox'; // no B2C details set: automatic payouts are off
process.env.MPESA_CONSUMER_KEY = 'key';
process.env.MPESA_CONSUMER_SECRET = 'secret';
process.env.MPESA_PASSKEY = 'pk';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';
process.env.SMS_PROVIDER = 'off';

const { createApp } = await import('../src/app.js');
const { createUser, NO_APP_PASSWORD } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { dailyPayoutRun, remindDrivers } = await import('../src/services/payouts.js');
const { handleStkCallback } = await import('../src/services/payments.js');
const attention = await import('../src/services/attention.js');
const needsAttention = async () => (await attention.needsAttention()).items;
const { reconcile } = await import('../src/services/reconciliation.js');

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
const pay = (car) => api('POST', '/passenger/pay', { token: s.passenger, body: { qr: car.qr_token, stop_id: s.stop.id, expected_fare: s.stop.app_fare, idempotency_key: randomUUID() } });
const owed = async () => (await api('GET', '/admin/payouts/owed', { token: s.admin })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await createUser({ name: 'Office', phone: '254700000001', password: 'Admin1234', role: 'admin' });
  await createUser({ name: 'Other Office', phone: '254700000009', password: 'Admin1234', role: 'admin' });
  s.platform = await createUser({ name: 'Runs FarePay', phone: '254700000010', password: 'Admin1234', role: 'platform_admin' });
  await createUser({ name: 'Dan Driver', phone: '254700000002', password: 'Adrive123', role: 'driver' });
  await createUser({ name: 'Dee Driver', phone: '254700000003', password: 'Adrive123', role: 'driver' });
  s.admin = await login('0700000001', 'Admin1234');
  s.dan = await login('0700000002', 'Adrive123');
  s.dee = await login('0700000003', 'Adrive123');

  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', fare: 80, stops: [{ name: 'Juja' }, { name: 'Thika' }] } })).body;
  s.other = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Kiambu Road', origin: 'Town', fare: 60, stops: [{ name: 'Kiambu' }] } })).body;
  s.stop = route.stops[0];
  const car = async (plate, owner_phone) =>
    (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate, owner_name: 'Mary Owner', owner_phone, route_id: route.id } })).body;
  s.car1 = await car('KDA 001A', '0744555666');
  s.car2 = await car('KDA 002A', '0744555666');
  s.car3 = await car('KDA 003A', '0755666777');
  await api('POST', '/crew/vehicle/claim', { token: s.dan, body: { qr: s.car1.qr_token } });
  await api('POST', '/crew/vehicle/claim', { token: s.dee, body: { qr: s.car2.qr_token } });

  // No SMS: signing up needs no code.
  const code = await api('POST', '/auth/register/code', { body: { phone: '0722333444' } });
  assert.equal(code.body.code_needed, false);
  const signedUp = await api('POST', '/auth/register', { body: { name: 'Pat Passenger', phone: '0722333444', password: 'Apass123' } });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));
  s.passenger = signedUp.body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 2000 }));
});
after(() => server.close());

test('the evening reminder goes to drivers with fares not sent, and says how much', async () => {
  await pay(s.car1);
  await pay(s.car2);
  await pay(s.car3); // no driver on this car: nobody to remind
  assert.equal(await remindDrivers(), 2);
  const notes = await db.all("SELECT n.title, n.body FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.kind = 'owner_money.reminder' AND u.phone = '254700000002'");
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /KES 80 from 1 fare on KDA 001A/);
});

test('the driver is told the truth: the office sends it, and no payout is made yet', async () => {
  const seen = await api('GET', '/crew/owner-money', { token: s.dan });
  assert.equal(seen.body.by_hand, true);
  const sent = await api('POST', '/crew/owner-money/send', { token: s.dan });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.by_hand, true);
  assert.equal(sent.body.total, 80);
  assert.deepEqual(sent.body.payouts, []);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM payouts')).n, 0);
  assert.equal((await api('POST', '/crew/owner-money/send', { token: s.dan })).status, 409, 'nothing new to send');
});

test('the office sees each car waiting, and can send it on for an absent driver (recorded)', async () => {
  const before = await owed();
  assert.deepEqual(before.cars_waiting.map((c) => [c.plate, c.driver_name, c.fares, c.total]), [
    ['KDA 002A', 'Dee Driver', 1, 80],
    ['KDA 003A', null, 1, 80],
  ]);
  const done = await api('POST', `/admin/vehicles/${s.car3.id}/release-fares`, { token: s.admin });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.total, 80);
  assert.deepEqual((await owed()).cars_waiting.map((c) => c.plate), ['KDA 002A']);
  const logged = await db.get("SELECT details FROM audit_log WHERE action = 'payout.released_by_office'");
  assert.deepEqual(JSON.parse(logged.details), { fares: 1, total: 80 });
  assert.equal((await api('POST', `/crew/vehicle/claim`, { token: s.passenger, body: { qr: s.car3.qr_token } })).status, 403);
  assert.equal((await api('POST', `/admin/vehicles/${s.car3.id}/release-fares`, { token: s.passenger })).status, 403, 'office only');
});

test('fares left over from an earlier day appear on Needs attention', async () => {
  assert.equal((await needsAttention()).find((i) => i.key === 'fares_waiting'), undefined, 'today’s fares are not an alarm');
  await db.run("UPDATE trips SET created_at = ? WHERE vehicle_id = ?", new Date(Date.now() - 3 * 86_400_000).toISOString(), s.car2.id);
  const item = (await needsAttention()).find((i) => i.key === 'fares_waiting');
  assert.equal(item.count, 1);
  assert.equal(item.link, 'payouts');
});

test('an owner with two cars gets one payment in the evening run', async () => {
  await api('POST', '/crew/owner-money/send', { token: s.dee });
  assert.equal((await needsAttention()).find((i) => i.key === 'fares_waiting'), undefined);
  const paid = await dailyPayoutRun();
  assert.deepEqual(paid.map((p) => [p.owner_phone, p.amount, p.trip_count, p.status]).sort(), [
    ['254744555666', 160, 2, 'manual'],
    ['254755666777', 80, 1, 'manual'],
  ]);
  const check = await reconcile();
  assert.equal(check.all_ok, true, JSON.stringify(check.failed));
});

test('a driver on a car with no conductor can change the route; a passenger cannot', async () => {
  const seen = await api('GET', '/crew/vehicle', { token: s.dan });
  assert.equal(seen.body.has_conductor, false);
  const changed = await api('PUT', '/crew/vehicle/route', { token: s.dan, body: { route_id: s.other.id } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.route.id, s.other.id);
});

test('M-Pesa confirms late for someone with no app: it goes back to their M-Pesa, for the office to send', async () => {
  const id = await db.insert(
    'INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)',
    'M-Pesa 0733',
    '254733000111',
    NO_APP_PASSWORD,
    'passenger',
  );
  await db.run('INSERT INTO wallets (user_id) VALUES (?)', id);
  await db.insert(
    "INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, result_desc, checkout_request_id) VALUES (?, '254733000111', 80, 'fare', 'failed', 'No answer from M-Pesa (expired)', 'ws_late')",
    id,
  );
  await handleStkCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_late', ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'LATE0001' }] } } } });

  assert.equal((await db.get('SELECT balance FROM wallets WHERE user_id = ?', id)).balance, 0);
  const w = await db.get('SELECT amount, status, phone FROM withdrawals WHERE user_id = ?', id);
  assert.deepEqual({ ...w }, { amount: 80, status: 'manual', phone: '254733000111' });
  assert.ok((await needsAttention()).some((i) => i.key === 'withdrawals'));
  const check = await reconcile();
  assert.equal(check.all_ok, true, JSON.stringify(check.failed));
});

test('the office sets a new password for a colleague, and a broadcast has no SMS', async () => {
  const other = await db.get("SELECT id FROM users WHERE phone = '254700000009'");
  const reset = await api('POST', `/admin/users/${other.id}/password`, { token: s.admin, body: { new_password: 'Newpass123' } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(await login('0700000009', 'Newpass123'));
  assert.equal((await api('POST', `/admin/users/${s.platform.id}/password`, { token: s.admin, body: { new_password: 'Newpass123' } })).status, 404, 'never a platform admin');
  const sent = await api('POST', '/admin/broadcast', { token: s.admin, body: { audience: 'drivers', message: 'Road closed at Juja', sms: true } });
  assert.deepEqual(sent.body, { sent_to: 2 });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM sms_outbox')).n, 0, 'not one text in the whole run');
});
