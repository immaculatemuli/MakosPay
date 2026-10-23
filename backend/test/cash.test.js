// Cash fares: the crew enter the day's cash once (a driver without a conductor too); the office and the owner see it
// beside the FarePay money, and it never touches wallets or payouts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.PAYOUTS_NEED_DRIVER = 'false'; // these tests pay owners without the driver's "Send to owner"
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SMS_PROVIDER = 'log';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { remindCash } = await import('../src/services/cash.js');
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
const daysAgo = (n) => new Date(Date.parse(`${nairobiToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Grace Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Machakos', stops: [{ name: 'Nairobi', fare: 100 }] } })).body;
  const crew = (n, role) => api('POST', `/admin/${role}s`, { token: s.admin, body: { name: `${role} ${n}`, phone: `07110000${n}`, password: 'crew123' } });
  const c1 = (await crew('01', 'conductor')).body;
  const d1 = (await crew('02', 'driver')).body;
  const d2 = (await crew('03', 'driver')).body;
  const car = (plate, extra) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: s.route.id, owner_name: 'Mary Owner', owner_phone: '0744555666', ...extra } });
  s.withConductor = (await car('KDA 123A', { conductor_id: c1.id, driver_id: d1.id })).body;
  s.driverOnly = (await car('KDB 123S', { driver_id: d2.id })).body;
  s.conductor = await login('0711000001', 'crew123');
  s.driver = await login('0711000002', 'crew123');
  s.soloDriver = await login('0711000003', 'crew123');
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
  const stop = s.route.stops[0];
  for (const v of [s.withConductor, s.driverOnly]) {
    await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: v.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } });
  }
});
after(() => server.close());

test('nothing entered yet: the day shows no cash', async () => {
  const day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.equal(day.cash, null);
});

test('the evening reminder goes to the crew of cars that worked today without entering cash', async () => {
  assert.equal(await remindCash(), 2);
  const told = await db.all("SELECT u.phone FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.kind = 'cash.reminder' ORDER BY u.phone");
  assert.deepEqual(told.map((r) => r.phone), ['254711000001', '254711000002', '254711000003'], 'conductor and driver, and the driver of the car without a conductor');
});

test('the conductor enters the cash, and corrects it later the same day', async () => {
  const first = await api('PUT', '/crew/cash', { token: s.conductor, body: { amount: 3000 } });
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.day, first.body.amount, first.body.declared_by_name], [nairobiToday(), 3000, 'conductor 01']);
  const fixed = await api('PUT', '/crew/cash', { token: s.driver, body: { amount: 3200 } });
  assert.deepEqual([fixed.body.amount, fixed.body.declared_by_name], [3200, 'driver 02'], 'one figure per car and day: the latest');
  const day = (await api('GET', '/crew/payments', { token: s.conductor })).body;
  assert.equal(day.cash.amount, 3200);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM cash_declarations')).n, 1);
});

test('a driver alone on a car enters its cash too; yesterday is allowed, older days and odd amounts are not', async () => {
  assert.equal((await api('PUT', '/crew/cash', { token: s.soloDriver, body: { amount: 1500 } })).status, 200);
  assert.equal((await api('PUT', '/crew/cash', { token: s.soloDriver, body: { day: daysAgo(1), amount: 900 } })).status, 200);
  const old = await api('PUT', '/crew/cash', { token: s.soloDriver, body: { day: daysAgo(2), amount: 900 } });
  assert.equal(old.body.error.code, 'CASH_DAY');
  for (const amount of [-1, 10.5, 200_001]) assert.equal((await api('PUT', '/crew/cash', { token: s.soloDriver, body: { amount } })).status, 400, String(amount));
  assert.equal((await api('PUT', '/crew/cash', { token: s.passenger, body: { amount: 100 } })).status, 403);
});

test('cash never touches the money: no wallet entry, nothing owed to the owner', async () => {
  const owed = await db.get("SELECT COALESCE(SUM(fare), 0) AS n FROM trips WHERE owner_phone = '254744555666' AND payout_id IS NULL");
  assert.equal(owed.n, 200, 'only the two FarePay fares');
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM wallet_transactions WHERE description LIKE '%cash%'")).n, 0);
});

test('the office sees each day: FarePay fares beside the cash declared', async () => {
  const days = (await api('GET', `/admin/vehicles/${s.driverOnly.id}/cash`, { token: s.admin })).body;
  assert.equal(days.length, 14);
  assert.deepEqual(days[0], { day: nairobiToday(), farepay_payments: 1, farepay_total: 100, cash: 1500, cash_by: 'driver 03' });
  assert.deepEqual([days[1].day, days[1].cash, days[1].farepay_total], [daysAgo(1), 900, 0]);
  assert.equal(days[2].cash, null);
  assert.equal((await api('GET', `/admin/vehicles/${s.driverOnly.id}/cash`, { token: s.conductor })).status, 403);
});

test("the owner's payout SMS also says the cash the crew declared", async () => {
  const run = await api('POST', '/admin/payouts/run', { token: s.admin });
  assert.ok(run.status < 300, JSON.stringify(run.body));
  const sms = await db.get("SELECT message FROM sms_outbox WHERE phone = '254744555666' AND kind = 'payout.owner'");
  assert.match(sms.message, /KES 200 sent to your M-Pesa/);
  assert.match(sms.message, /Cash declared by crew: KDA 123A 3,200, KDB 123S 1,500\./);
});

test('no reminder once the cash is in', async () => {
  await db.run("DELETE FROM notifications WHERE kind = 'cash.reminder'");
  assert.equal(await remindCash(), 0);
});
