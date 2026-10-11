// Daily jobs and payouts can never run twice: not on a restart, not when two copies start at the same moment.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { claimDailyRun } = await import('../src/services/jobs.js');
const { createPayout, payEveryone } = await import('../src/services/payouts.js');
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
const s = {};
const pay = (stop, vehicle) =>
  api('POST', '/passenger/pay', { token: s.passenger, body: { qr: vehicle.qr_token, stop_id: stop.id, expected_fare: stop.app_fare, idempotency_key: randomUUID() } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }] } })).body;
  s.stop = route.stops[0];
  s.mary = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: route.id } })).body;
  s.john = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777', route_id: route.id } })).body;
  const reg = await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } });
  s.passenger = reg.body.token;
  await tx(() => postWalletEntry(reg.body.user.id, { type: 'test_credit', amount: 1000 }));
});
after(() => server.close());

test("ten servers starting at once: only one gets today's daily run, and a restart doesn't run it again", async () => {
  const claims = await Promise.all(Array.from({ length: 10 }, () => claimDailyRun('daily_payouts', '2026-10-11')));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await claimDailyRun('daily_payouts', '2026-10-11'), false, 'after a restart the same day');
  assert.equal(await claimDailyRun('daily_payouts', '2026-10-12'), true, 'the next day runs again');
  assert.equal(await claimDailyRun('money_check', '2026-10-12'), true, 'each job has its own day');
});

test('"pay this owner now" pressed five times at once sends one payout', async () => {
  await pay(s.stop, s.mary);
  await pay(s.stop, s.mary);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => createPayout('254744555666', null)));
  const made = results.filter((r) => r.status === 'fulfilled');
  assert.equal(made.length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'NOTHING_TO_PAY'));
  assert.equal(made[0].value.amount, 100);
  const payouts = (await db.all('SELECT owner_name, amount FROM payouts')).map((p) => [p.owner_name, p.amount]);
  assert.deepEqual(payouts, [['Mary', 100]]);
});

test('"pay everyone" run twice at once pays each owner once, and the books still balance', async () => {
  await pay(s.stop, s.mary);
  await pay(s.stop, s.john);
  await Promise.all([payEveryone(), payEveryone()]);
  const payouts = await db.all('SELECT owner_name, amount FROM payouts ORDER BY id');
  assert.deepEqual(payouts.slice(1).map((p) => p.owner_name).sort(), ['John', 'Mary']);
  assert.equal(payouts.length, 3);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM trips WHERE status = 'paid' AND payout_id IS NULL")).n, 0);
  const check = await reconcile();
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});
