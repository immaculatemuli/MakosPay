// Phase 3: fare history with effective dates, the audit log, and reconciliation.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { applyDueFareChanges } = await import('../src/services/routes.js');

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
const nairobiDate = (days) => new Date(Date.now() + 3 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
const juja = async () => (await api('GET', `/admin/routes/${s.route.id}`, { token: s.admin })).body.stops.find((x) => x.name === 'Juja');
const pay = async (fare) =>
  api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: fare, idempotency_key: randomUUID() } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office Clerk', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 80, app_fare: 60 }] } })).body;
  s.stop = s.route.stops[0];
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: s.route.id } })).body;
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'Apass123' })).body.token;
  s.pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(s.pid, { type: 'test_credit', amount: 1000 }));
});
after(() => server.close());

test('editing a fare records who changed it, the old and new fares, and keeps past payments as they were', async () => {
  const before = (await pay(60)).body.trip;
  await api('PATCH', `/admin/routes/${s.route.id}`, { token: s.admin, body: { stops: [{ id: s.stop.id, name: 'Juja', cash_fare: 90, app_fare: 70 }] } });

  const history = (await api('GET', `/admin/routes/${s.route.id}/fare-changes`, { token: s.admin })).body;
  assert.equal(history.length, 1);
  assert.deepEqual(
    [history[0].old_cash_fare, history[0].old_app_fare, history[0].new_cash_fare, history[0].new_app_fare, history[0].changed_by_name, history[0].stop_name],
    [80, 60, 90, 70, 'Office Clerk', 'Juja'],
  );
  assert.ok(history[0].applied_at, 'in effect straight away');

  const trips = (await api('GET', '/passenger/trips', { token: s.passenger })).body.items;
  assert.equal(trips.find((t) => t.id === before.id).fare, 60, 'the earlier payment still shows the fare paid');
});

test('a fare change dated in the future waits, then takes effect on its date', async () => {
  const r = await api('POST', `/admin/stops/${s.stop.id}/fare-change`, {
    token: s.admin,
    body: { cash_fare: 100, app_fare: 80, effective_date: nairobiDate(2), reason: 'Fuel price rise' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.applied_at, null);
  assert.equal((await juja()).app_fare, 70, 'today the old fare still applies');
  assert.equal((await pay(70)).status, 201);

  const upcoming = (await api('GET', '/passenger/fare-changes', { token: s.passenger })).body;
  assert.ok(upcoming.some((c) => c.new_app_fare === 80 && c.applied_at === null), 'passengers can see the coming change');

  // Two days later:
  applyDueFareChanges(new Date(Date.now() + 2 * 86_400_000 + 3600_000).toISOString());
  assert.equal((await juja()).app_fare, 80);
  assert.equal((await pay(70)).body.error.code, 'FARE_CHANGED', 'nobody is charged the old fare after the change');
});

test('a waiting change can be cancelled, and a newer one replaces it', async () => {
  const first = (await api('POST', `/admin/stops/${s.stop.id}/fare-change`, { token: s.admin, body: { cash_fare: 120, app_fare: 100, effective_date: nairobiDate(5) } })).body;
  const second = (await api('POST', `/admin/stops/${s.stop.id}/fare-change`, { token: s.admin, body: { cash_fare: 110, app_fare: 90, effective_date: nairobiDate(5) } })).body;
  const history = (await api('GET', `/admin/routes/${s.route.id}/fare-changes`, { token: s.admin })).body;
  assert.ok(history.find((h) => h.id === first.id).cancelled_at, 'replaced');
  assert.equal((await api('POST', `/admin/fare-changes/${second.id}/cancel`, { token: s.admin })).body.cancelled_at !== null, true);
  const applied = history.find((h) => h.applied_at);
  assert.equal((await api('POST', `/admin/fare-changes/${applied.id}/cancel`, { token: s.admin })).status, 409, "can't cancel one already in effect");
});

test('a change dated today applies at once; Member Fare above cash fare is refused', async () => {
  assert.equal((await api('POST', `/admin/stops/${s.stop.id}/fare-change`, { token: s.admin, body: { cash_fare: 50, app_fare: 60, effective_date: nairobiDate(0) } })).status, 400);
  const now = (await api('POST', `/admin/stops/${s.stop.id}/fare-change`, { token: s.admin, body: { cash_fare: 95, app_fare: 75, effective_date: nairobiDate(0) } })).body;
  assert.ok(now.applied_at);
  assert.equal((await juja()).app_fare, 75);
});

test('the audit log records office actions with who did them, without passwords', async () => {
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'Asecret99' } })).body;
  const trip = (await pay(75)).body.trip;
  await api('POST', `/admin/payments/${trip.id}/refund`, { token: s.admin, body: { reason: 'Vehicle broke down' } });

  const log = (await api('GET', '/admin/audit?limit=100', { token: s.admin })).body.items;
  const refund = log.find((e) => e.action === 'POST /admin/payments/:id/refund');
  assert.ok(refund, JSON.stringify(log.map((e) => e.action)));
  assert.deepEqual([refund.actor_name, refund.actor_role, refund.entity, refund.entity_id, refund.details.reason], ['Office Clerk', 'admin', 'payments', trip.id, 'Vehicle broke down']);
  const created = log.find((e) => e.action === 'POST /admin/conductors');
  assert.equal(created.details.password, '[hidden]', 'passwords are never stored');
  assert.ok(!JSON.stringify(log).includes('Asecret99'));
  assert.ok(log.some((e) => e.action === 'POST /admin/stops/:id/fare-change' && e.entity_id === s.stop.id));

  assert.ok(log.every((e) => e.action !== 'GET'), 'reading is not logged');
  const failed = await api('POST', `/admin/payments/${trip.id}/refund`, { token: s.admin, body: { reason: 'again' } });
  assert.equal(failed.status, 409);
  const after = (await api('GET', '/admin/audit?limit=100', { token: s.admin })).body.items;
  assert.equal(after.filter((e) => e.action === 'POST /admin/payments/:id/refund').length, 1, 'refused actions are not logged as done');
  void c;
});

test('the audit log cannot be changed or deleted, even directly in the database', async () => {
  await assert.rejects(db.run("UPDATE audit_log SET action = 'nothing'"), /cannot be changed/);
  await assert.rejects(db.run('DELETE FROM audit_log'), /cannot be (changed or )?deleted/);
});

test('reconciliation: everything adds up, and a tampered balance is caught', async () => {
  const ok = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(ok.all_ok, true, JSON.stringify(ok.checks.filter((c) => !c.ok)));
  assert.equal(ok.totals.real_money, false, 'mock money is labelled as not real');
  assert.equal(ok.totals.test_credit, 1000);

  (await db.run('UPDATE wallets SET balance = balance + 500 WHERE user_id = ?', s.pid));
  const bad = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(bad.all_ok, false);
  const check = bad.checks.find((c) => c.name.startsWith('Every wallet balance'));
  assert.equal(check.ok, false);
  assert.match(check.detail, /Pat/);
  (await db.run('UPDATE wallets SET balance = balance - 500 WHERE user_id = ?', s.pid));
});

test('passengers and crew cannot see the audit log or reconciliation', async () => {
  assert.equal((await api('GET', '/admin/audit', { token: s.passenger })).status, 403);
  assert.equal((await api('GET', '/admin/reconciliation', { token: s.passenger })).status, 403);
});
