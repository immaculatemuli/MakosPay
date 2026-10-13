// Parcels: recorded and paid at the office (PIN prompt, cash or an M-Pesa code), carried by a car on the route,
// followed on the website by tracking code, collected with the receiver's secret code. Fees are SACCO income.
import assert from 'node:assert/strict';
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
const newParcel = (payment, extra = {}) =>
  api('POST', '/admin/parcels', {
    token: s.admin,
    body: {
      sender_name: 'Sam Sender',
      sender_phone: '0722000111',
      receiver_name: 'Mary Wanjiku',
      receiver_phone: '0733000222',
      route_id: s.route.id,
      stop_id: s.far.id,
      description: 'Box of books',
      fee: 300,
      payment,
      ...extra,
    },
  });
const track = (code) => api('GET', `/book-api/parcels/${code}`);

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  s.route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Machakos Road', origin: 'Town', stops: [{ name: 'Athi River', fare: 100 }, { name: 'Machakos', fare: 200 }] } })).body;
  [s.near, s.far] = s.route.stops;
  s.other = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Other Road', origin: 'Town', stops: [{ name: 'Elsewhere', fare: 50 }] } })).body;
  for (const [n, routeId] of [[1, s.route.id], [2, s.other.id]]) {
    const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: `Conductor ${n}`, phone: `071100000${n}`, password: 'cond123' } })).body;
    await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: `KPA 00${n}A`, owner_name: 'Owner', owner_phone: '0744555666', conductor_id: c.id, route_id: routeId } });
    s[`crew${n}`] = (await api('POST', '/auth/login', { body: { phone: `071100000${n}`, password: 'cond123' } })).body.token;
  }
});
after(() => server.close());

test('the office records a parcel and the sender pays by the M-Pesa PIN prompt', async () => {
  const res = await newParcel('prompt');
  assert.equal(res.status, 201);
  const p = res.body;
  assert.equal(p.status, 'received', 'test M-Pesa confirms at once');
  assert.equal(p.payment_method, 'mpesa_prompt');
  assert.match(p.payment_reference, /^[A-Z0-9]+$/);
  assert.match(p.tracking_code, /^[A-Z0-9]{8}$/);
  assert.match(p.collection_code, /^\d{6}$/);
  assert.equal(p.payments.length, 1);
  assert.equal(p.payments[0].status, 'completed');
  s.p1 = p;
});

test('or pays cash, or by M-Pesa another way (a code can only be used once)', async () => {
  const cash = (await newParcel('cash')).body;
  assert.deepEqual([cash.status, cash.payment_method, cash.payment_reference], ['received', 'cash', null]);
  s.p2 = cash;
  const code = (await newParcel('mpesa_code', { mpesa_code: 'tkl12abc90' })).body;
  assert.deepEqual([code.status, code.payment_reference], ['received', 'TKL12ABC90']);
  s.p3 = code;
  assert.equal((await newParcel('mpesa_code', { mpesa_code: 'TKL12ABC90' })).body.error.code, 'CODE_USED');
  assert.equal((await newParcel('mpesa_code')).status, 400, 'the code is needed');
  assert.equal((await api('POST', `/admin/parcels/${cash.id}/payment`, { token: s.admin, body: { method: 'cash' } })).body.error.code, 'NOT_AWAITING_PAYMENT');
  assert.equal((await api('POST', `/admin/parcels/${cash.id}/prompt`, { token: s.admin })).body.error.code, 'NOT_AWAITING_PAYMENT');
});

test('anyone can track a parcel by its code, and sees nothing private', async () => {
  const t = await track(s.p1.tracking_code.toLowerCase());
  assert.equal(t.status, 200);
  assert.deepEqual([t.body.status, t.body.from, t.body.to, t.body.receiver, t.body.sender], ['received', 'Town', 'Machakos', 'Mary W.', 'Sam S.']);
  assert.deepEqual(t.body.events.map((e) => e.what), ['Recorded at the office', 'Paid, waiting for a car']);
  const text = JSON.stringify(t.body);
  for (const secret of [s.p1.collection_code, '0733000222', '733000222', '0722000111', 'Wanjiku', 'Box of books', '300']) assert.ok(!text.includes(secret), `does not show ${secret}`);
  assert.equal((await track('NOSUCHCD')).status, 404);
});

test("the crew see paid parcels for their route, and load one onto their car", async () => {
  const mine = (await api('GET', '/crew/parcels', { token: s.crew1 })).body;
  assert.deepEqual(mine.waiting.map((p) => p.tracking_code).sort(), [s.p1, s.p2, s.p3].map((p) => p.tracking_code).sort());
  assert.equal(mine.waiting[0].receiver_phone, '0733***222', 'part-hidden number');
  assert.equal(JSON.stringify(mine).includes(s.p1.collection_code), false, 'crew never see the collection code');
  assert.deepEqual((await api('GET', '/crew/parcels', { token: s.crew2 })).body.waiting, [], 'not for the other route');
  assert.equal((await api('POST', `/crew/parcels/${s.p1.id}/load`, { token: s.crew2 })).body.error.code, 'CANNOT_LOAD');

  await api('POST', '/crew/loading/start', { token: s.crew1 });
  const loaded = (await api('POST', `/crew/parcels/${s.p1.id}/load`, { token: s.crew1 })).body;
  assert.equal(loaded.on_car[0].tracking_code, s.p1.tracking_code);
  assert.equal(loaded.on_car[0].status, 'on_the_way');
  const t = (await track(s.p1.tracking_code)).body;
  assert.deepEqual([t.status, t.plate], ['on_the_way', 'KPA 001A']);
  assert.ok(t.events.some((e) => e.what === 'Loaded onto KPA 001A'));
});

test('ticking the destination stop on the trip marks its parcels arrived', async () => {
  await api('POST', `/crew/parcels/${s.p2.id}/load`, { token: s.crew1 });
  await api('POST', '/crew/loading/depart', { token: s.crew1 });
  await api('POST', `/crew/road/stops/${s.near.id}`, { token: s.crew1 });
  assert.equal((await track(s.p1.tracking_code)).body.status, 'on_the_way', 'not its stop');
  await api('POST', `/crew/road/stops/${s.far.id}`, { token: s.crew1 });
  const t = (await track(s.p1.tracking_code)).body;
  assert.equal(t.status, 'arrived');
  assert.ok(t.events.some((e) => e.what === 'Left Town') && t.events.some((e) => e.what === 'Arrived at Machakos'));
});

test('collecting needs the right code; too many wrong tries are stopped', async () => {
  const wrong = await api('POST', `/crew/parcels/${s.p1.id}/collect`, { token: s.crew1, body: { code: '000000' === s.p1.collection_code ? '111111' : '000000' } });
  assert.equal(wrong.body.error.code, 'WRONG_CODE');
  const ok = await api('POST', `/crew/parcels/${s.p1.id}/collect`, { token: s.crew1, body: { code: s.p1.collection_code } });
  assert.equal(ok.status, 200);
  assert.equal((await track(s.p1.tracking_code)).body.status, 'collected');
  const again = await api('POST', `/crew/parcels/${s.p1.id}/collect`, { token: s.crew1, body: { code: s.p1.collection_code } });
  assert.equal(again.body.error.code, 'CANNOT_COLLECT');
  assert.match(again.body.error.message, /already been collected/);

  const bad = s.p2.collection_code === '999999' ? '888888' : '999999';
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await api('POST', `/admin/parcels/${s.p2.id}/collect`, { token: s.admin, body: { code: bad } })).status);
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});

test('the office hands over a parcel at the office with the code', async () => {
  const res = await api('POST', `/admin/parcels/${s.p3.id}/collect`, { token: s.admin, body: { code: s.p3.collection_code } });
  assert.equal(res.body.status, 'collected');
  assert.equal(res.body.collected_by_name, 'Office');
});

test('only a parcel not yet loaded can be cancelled', async () => {
  const p = (await newParcel('cash')).body;
  const cancelled = await api('POST', `/admin/parcels/${p.id}/cancel`, { token: s.admin, body: { reason: 'Sender changed their mind' } });
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await api('POST', `/admin/parcels/${s.p2.id}/cancel`, { token: s.admin, body: { reason: 'Too late' } })).body.error.code, 'CANNOT_CANCEL');
});

test('the office list: search and totals; the audit log never holds a collection code', async () => {
  const list = (await api('GET', '/admin/parcels?search=mary', { token: s.admin })).body;
  assert.ok(list.parcels.length >= 3);
  assert.deepEqual(list.last_30_days, { paid: 3, fees: 900 }, 'cancelled parcels are not income');
  assert.equal((await api('GET', '/admin/parcels?status=collected', { token: s.admin })).body.parcels.length, 2);
  const log = JSON.stringify((await db.all('SELECT details FROM audit_log')).map((r) => r.details));
  for (const p of [s.p1, s.p2, s.p3]) assert.ok(!log.includes(p.collection_code), 'collection code hidden in the audit log');
});

test('parcel fees are kept apart: the money check still adds up, and the statement check knows them', async () => {
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
  const receipt = s.p1.payment_reference;
  const csv = [
    'Receipt No.,Completion Time,Initiation Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Balance Confirmed,Reason Type,Other Party Info,Linked Transaction ID,A/C No.',
    `${receipt},2026-10-13 10:00:00,2026-10-13 10:00:00,Pay Bill from 2547******11 - SAM,Completed,300.00,,300.00,true,Pay Bill Online,2547******11,,`,
  ].join('\r\n');
  const r = (await api('POST', '/admin/statement-check', { token: s.admin, body: { csv } })).body;
  assert.deepEqual([r.money_in.matched, r.money_in.amount, r.money_in.not_in_farepay.length], [1, 300, 0]);
});
