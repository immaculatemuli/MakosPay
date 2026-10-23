// "Paid by mistake": a conductor or driver asks for a refund of a payment on their car; only the office decides.
// App passengers get the money in their wallet, passengers without the app on their M-Pesa.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { signUp } from './signup.js';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';
process.env.SMS_PROVIDER = 'log';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
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
const balance = async (phone) => (await db.get('SELECT w.balance FROM wallets w JOIN users u ON u.id = w.user_id WHERE u.phone = ?', phone)).balance;
const s = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Grace Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Machakos', stops: [{ name: 'Nairobi', fare: 100 }] } })).body;
  s.stop = s.route.stops[0];
  const crew = (n, role) => api('POST', `/admin/${role}s`, { token: s.admin, body: { name: `${role} ${n}`, phone: `07110000${n}`, password: 'crew123' } });
  const c1 = (await crew('01', 'conductor')).body;
  const d2 = (await crew('02', 'driver')).body;
  const car = (plate, extra) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: s.route.id, owner_name: 'Mary Owner', owner_phone: '0744555666', ...extra } });
  s.car = (await car('KDA 123A', { conductor_id: c1.id })).body;
  s.otherCar = (await car('KDB 456B', { driver_id: d2.id })).body;
  s.conductor = await login('0711000001', 'crew123');
  s.otherDriver = await login('0711000002', 'crew123');
  s.passenger = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 1000 }));
  s.pay = async () =>
    (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: s.car.qr_token, stop_id: s.stop.id, expected_fare: s.stop.app_fare, idempotency_key: randomUUID() } })).body.trip;
});
after(() => server.close());

const ask = (token, tripId, reason = 'Paid on the wrong car') => api('POST', `/crew/payments/${tripId}/refund-request`, { token, body: { reason } });
const crewPayment = async (token, tripId) => (await api('GET', '/crew/payments', { token })).body.payments.find((p) => p.id === tripId);

test('the conductor asks; the office is told and sees it in Needs attention', async () => {
  const trip = await s.pay();
  assert.equal((await crewPayment(s.conductor, trip.id)).refund_request, null);

  const res = await ask(s.conductor, trip.id);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'waiting');
  assert.deepEqual((await crewPayment(s.conductor, trip.id)).refund_request, { status: 'waiting', office_note: null });

  const list = (await api('GET', '/admin/refund-requests', { token: s.admin })).body.requests;
  assert.equal(list.length, 1);
  assert.equal(list[0].ticket_code, trip.ticket_code);
  assert.equal(list[0].reason, 'Paid on the wrong car');
  assert.equal(list[0].requested_by_name, 'conductor 01');
  assert.equal(list[0].plate, 'KDA 123A');
  assert.equal(list[0].no_app, false);

  const attention = (await api('GET', '/admin/attention', { token: s.admin })).body.items;
  assert.equal(attention.find((i) => i.key === 'refund_requests')?.count, 1);
  const told = await db.get("SELECT n.title FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'admin' AND n.kind = 'refund_request.new'");
  assert.match(told.title, /KES 100 on KDA 123A/);
  s.first = { trip, request: list[0] };
});

test('one request at a time per payment; only the crew of that car; crew cannot refund themselves', async () => {
  assert.equal((await ask(s.conductor, s.first.trip.id)).body.error.code, 'ALREADY_ASKED');
  assert.equal((await ask(s.otherDriver, s.first.trip.id)).status, 404, 'another car’s crew');
  assert.equal((await ask(s.passenger, s.first.trip.id)).status, 403, 'not passengers');
  assert.equal((await api('POST', `/admin/refund-requests/${s.first.request.id}/approve`, { token: s.conductor })).status, 403, 'crew cannot approve');
  assert.equal((await api('POST', `/admin/payments/${s.first.trip.id}/refund`, { token: s.conductor, body: { reason: 'mine' } })).status, 403);
  assert.equal((await ask(s.conductor, s.first.trip.id, 'x')).status, 400, 'a reason is needed');
});

test('the office refunds: the money is back in the wallet, the crew are told, and it cannot be done twice', async () => {
  const before = await balance('254722333444');
  const res = await api('POST', `/admin/refund-requests/${s.first.request.id}/approve`, { token: s.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'refunded');
  assert.equal(res.body.decided_by_name, 'Grace Office');
  assert.equal(await balance('254722333444'), before + 100);
  assert.equal((await db.get('SELECT status FROM trips WHERE id = ?', s.first.trip.id)).status, 'refunded');

  const payment = await crewPayment(s.conductor, s.first.trip.id);
  assert.equal(payment.status, 'refunded');
  assert.equal(payment.refund_request.status, 'refunded');
  const told = await db.get("SELECT n.title FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = '254711000001' AND n.kind = 'refund_request.refunded'");
  assert.match(told.title, /Refund done: KES 100/);

  assert.equal((await api('POST', `/admin/refund-requests/${s.first.request.id}/approve`, { token: s.admin })).body.error.code, 'ALREADY_DECIDED');
  assert.equal(await balance('254722333444'), before + 100, 'not twice');
  assert.equal((await ask(s.conductor, s.first.trip.id)).body.error.code, 'ALREADY_REFUNDED');
  assert.equal((await api('GET', '/admin/refund-requests', { token: s.admin })).body.requests.length, 0, 'nothing waiting');
});

test('the office says no, with a note the crew see; the passenger keeps their ticket', async () => {
  const trip = await s.pay();
  const before = await balance('254722333444');
  await ask(s.conductor, trip.id, 'Passenger says they paid twice');
  const [request] = (await api('GET', '/admin/refund-requests', { token: s.admin })).body.requests;
  assert.equal((await api('POST', `/admin/refund-requests/${request.id}/decline`, { token: s.admin, body: {} })).status, 400, 'a note is needed');
  const res = await api('POST', `/admin/refund-requests/${request.id}/decline`, { token: s.admin, body: { note: 'Only one payment on the statement' } });
  assert.equal(res.body.status, 'declined');

  const payment = await crewPayment(s.conductor, trip.id);
  assert.equal(payment.status, 'paid');
  assert.deepEqual(payment.refund_request, { status: 'declined', office_note: 'Only one payment on the statement' });
  assert.equal(await balance('254722333444'), before);
  const all = (await api('GET', '/admin/refund-requests?status=all', { token: s.admin })).body.requests;
  assert.deepEqual(all.map((r) => r.status), ['declined', 'refunded']);
  // After a no, the crew can ask again (e.g. with more details).
  assert.equal((await ask(s.conductor, trip.id, 'Passenger showed both M-Pesa messages')).status, 201);
});

test('a passenger who paid without the app gets the refund on their M-Pesa', async () => {
  const paid = await api('POST', '/pay-api/pay', { body: { qr: s.car.qr_token, stop_id: s.stop.id, expected_fare: s.stop.app_fare, phone: '0733000111', idempotency_key: randomUUID() } });
  assert.equal(paid.body.status, 'paid');
  const trip = await db.get('SELECT id FROM trips WHERE ticket_code = ?', paid.body.ticket.code);
  await ask(s.conductor, trip.id);
  const request = (await api('GET', '/admin/refund-requests', { token: s.admin })).body.requests.find((r) => r.trip_id === trip.id);
  assert.equal(request.no_app, true);
  await api('POST', `/admin/refund-requests/${request.id}/approve`, { token: s.admin });

  const withdrawal = await db.get("SELECT w.amount, w.phone FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE u.phone = '254733000111'");
  assert.deepEqual({ ...withdrawal }, { amount: 100, phone: '254733000111' }, 'sent to their M-Pesa');
  assert.equal(await balance('254733000111'), 0, 'nothing left in a wallet they cannot use');
});

test('the money still adds up', async () => {
  const check = await reconcile();
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});
