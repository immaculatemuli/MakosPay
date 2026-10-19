// Vehicle owners: set up once; one owner's cars are paid together in one payout; changes reach all their cars.
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
const car = (plate, owner) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: s.route.id, ...owner } });
const ride = (vehicle) =>
  api('POST', '/passenger/pay', { token: s.p, body: { qr: vehicle.qr_token, stop_id: s.route.stops[0].id, expected_fare: 100, idempotency_key: randomUUID() } });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 120, app_fare: 100 }] } })).body;
  s.p = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body.token;
  const pid = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(pid, { type: 'test_credit', amount: 5000 }));
});
after(() => server.close());

test('cars with the same owner phone belong to one owner, who keeps their own payment details', async () => {
  const first = await car('KDA 001A', { owner_name: 'Mary Wanjiru', owner_phone: '0744555666' });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.owner_existing, false);
  // Typed again on a second car with different details: she is the same owner; her details stay.
  const second = await car('KDA 002A', { owner_name: 'M. Wanjiru', owner_phone: '0744 555 666', owner_payout_method: 'bank', owner_bank_name: 'KCB', owner_bank_paybill: '522522', owner_bank_account: '99999' });
  assert.equal(second.body.owner_existing, true);
  assert.equal(second.body.owner_name, 'Mary Wanjiru');
  assert.equal(second.body.owner_payout_method, 'mpesa');
  s.mary = first.body.owner_id;
  const third = await car('KDA 003A', { owner_id: s.mary });
  assert.equal(third.body.owner_phone, '254744555666');
  s.cars = [first.body, second.body, third.body];
  s.other = (await car('KDB 100B', { owner_name: 'John Kamau', owner_phone: '0755666777' })).body;

  const owners = (await api('GET', '/admin/owners', { token: s.admin })).body;
  assert.deepEqual(owners.map((o) => [o.name, o.vehicle_count]), [['John Kamau', 1], ['Mary Wanjiru', 3]]);
});

test('one payout per owner for all their cars, with each car’s takings shown', async () => {
  await ride(s.cars[0]);
  await ride(s.cars[1]);
  await ride(s.cars[1]);
  await ride(s.cars[2]);
  await ride(s.other);
  const detail = (await api('GET', `/admin/owners/${s.mary}`, { token: s.admin })).body;
  assert.deepEqual(detail.vehicles.map((v) => [v.plate, v.today_total]), [['KDA 001A', 100], ['KDA 002A', 200], ['KDA 003A', 100]]);
  assert.equal(detail.owed, 400);

  const paid = await api('POST', '/admin/payouts/run', { token: s.admin });
  assert.ok(paid.status < 300, JSON.stringify(paid.body));
  const payouts = await db.all('SELECT owner_name, owner_id, amount, trip_count FROM payouts ORDER BY amount DESC');
  assert.deepEqual(payouts.map((p) => ({ ...p })), [
    { owner_name: 'Mary Wanjiru', owner_id: s.mary, amount: 400, trip_count: 4 },
    { owner_name: 'John Kamau', owner_id: s.other.owner_id, amount: 100, trip_count: 1 },
  ]);
  assert.equal((await api('GET', `/admin/owners/${s.mary}`, { token: s.admin })).body.payouts.length, 1);
});

test('changing an owner’s details reaches all their cars; a new phone takes the unpaid fares with it', async () => {
  await ride(s.cars[0]); // KES 100 unpaid, under her old number
  const r = await api('PATCH', `/admin/owners/${s.mary}`, {
    token: s.admin,
    body: { phone: '0733000111', payout_method: 'bank', bank_name: 'Equity', bank_paybill: '247247', bank_account: 'ACC-1' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cars = await db.all('SELECT owner_phone, owner_payout_method, owner_bank_paybill FROM vehicles WHERE owner_id = ?', s.mary);
  assert.ok(cars.every((c) => c.owner_phone === '254733000111' && c.owner_payout_method === 'bank' && c.owner_bank_paybill === '247247'));
  assert.equal((await api('GET', `/admin/owners/${s.mary}`, { token: s.admin })).body.owed, 100, 'the unpaid fare followed her');
  assert.equal((await api('PATCH', `/admin/owners/${s.mary}`, { token: s.admin, body: { phone: '0755666777' } })).status, 409, "another owner's number");
  assert.equal((await api('PATCH', `/admin/owners/${s.mary}`, { token: s.admin, body: { bank_account: '' } })).status, 400, 'bank needs an account');
});

test('a car moves to another owner; the money check still adds up; owners are found by search', async () => {
  const moved = await api('PATCH', `/admin/vehicles/${s.cars[2].id}`, { token: s.admin, body: { owner_id: s.other.owner_id } });
  assert.equal(moved.body.owner_name, 'John Kamau');
  const found = (await api('GET', '/admin/search?q=wanjiru', { token: s.admin })).body;
  assert.equal(found[0].kind, 'owner');
  assert.equal(found[0].link, `owner:${s.mary}`);
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});

test('Excel import: several cars of one owner, no clashing payment details', async () => {
  const rows = [
    { Plate: 'KDC 1', Route: 'Thika Road', 'Owner name': 'Ann', 'Owner phone': '0766000001', 'Paid by': 'M-Pesa' },
    { Plate: 'KDC 2', Route: 'Thika Road', 'Owner name': 'Ann', 'Owner phone': '0766000001', 'Paid by': '' },
    { Plate: 'KDC 3', Route: 'Thika Road', 'Owner name': 'Ann', 'Owner phone': '0766000001', 'Paid by': 'Bank', 'Bank name': 'KCB', 'Bank paybill': '522522', 'Bank account': '12345' },
  ];
  const bad = (await api('POST', '/admin/import/vehicles', { token: s.admin, body: { rows } })).body;
  assert.match(bad.rows[2].errors.join(), /Different payment details for the same owner as row 2/);
  const ok = (await api('POST', '/admin/import/vehicles', { token: s.admin, body: { rows: rows.slice(0, 2), commit: true } })).body;
  assert.equal(ok.summary, '2 vehicles of 1 owner');
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM vehicles v JOIN owners o ON o.id = v.owner_id WHERE o.phone = '254766000001'")).n, 2);
});
