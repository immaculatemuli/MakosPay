// Reports for the accountant: CSV files (Excel) of takings per day, car, owner and route, every payment and payout.
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
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
/** A report as rows of cells (the file starts with a BOM so Excel reads it as UTF-8). */
async function report(kind, from = today, to = today) {
  const res = await fetch(`${base}/admin/exports/${kind}?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${s.admin}` } });
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString('utf8');
  return { bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), text, rows: text.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(',')) };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 120, app_fare: 100 }] } })).body;
  const car = (plate, owner) => api('POST', '/admin/vehicles', { token: s.admin, body: { plate, route_id: route.id, ...owner } }).then((r) => r.body);
  const a = await car('KDA 001A', { owner_name: 'Mary Wanjiru', owner_phone: '0744555666' });
  const b = await car('KDA 002A', { owner_name: 'Mary Wanjiru', owner_phone: '0744555666' });
  const c = await car('KDB 003B', { owner_name: '=HYPERLINK("x")', owner_phone: '0755666777' });
  const p = (await signUp(api, { name: 'Pat', phone: '0722333444', password: 'pass123' })).body.token;
  await tx(async () => postWalletEntry((await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id, { type: 'test_credit', amount: 5000 }));
  const pay = (v) => api('POST', '/passenger/pay', { token: p, body: { qr: v.qr_token, stop_id: route.stops[0].id, expected_fare: 100, idempotency_key: randomUUID() } }).then((r) => r.body.trip);
  await pay(a);
  await pay(a);
  await pay(b);
  const refunded = await pay(c);
  await api('POST', `/admin/payments/${refunded.id}/refund`, { token: s.admin, body: { reason: 'Car broke down' } });
});
after(() => server.close());

test('takings per day: a row for each day and a total, refunds apart', async () => {
  const r = await report('daily');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/csv/);
  assert.match(r.disposition, /attachment; filename="FarePay Takings per day /);
  assert.ok(r.bom, 'Excel reads it as UTF-8');
  assert.deepEqual(r.rows[1], [today, '3', '300', '0', '1', '100']);
  assert.deepEqual(r.rows.at(-1), ['TOTAL', '3', '300', '0', '1', '100']);
  const week = await report('daily', new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10), today);
  assert.equal(week.rows.length, 1 + 7 + 1, 'heading, 7 days, total');
});

test('per car, owner and route', async () => {
  const cars = (await report('vehicles')).rows;
  assert.deepEqual(cars[1], ['KDA 001A', 'Mary Wanjiru', '="0744555666"', 'Thika Road', '2', '200'], 'phone kept with its 0');
  const owners = (await report('owners')).rows;
  assert.ok(owners.some((o) => o[0] === 'Mary Wanjiru' && o[3] === '2' && o[4] === '3' && o[5] === '300'));
  assert.ok(owners.some((o) => o[0].startsWith("\"'=HYPERLINK")), 'a name starting with = never becomes an Excel formula');
  assert.deepEqual((await report('routes')).rows[1], ['Thika Road', 'Town', '3', '300']);
});

test('every payment and every payout', async () => {
  const pays = (await report('payments')).rows;
  assert.equal(pays.length, 5);
  assert.ok(pays.some((r) => r[7] === 'refunded' && r[11] === 'Car broke down'));
  await api('POST', '/admin/payouts/run', { token: s.admin });
  const payouts = (await report('payouts')).rows;
  assert.ok(payouts.some((r) => r[2] === 'Mary Wanjiru' && r[5] === '300'));
});

test('bad requests are refused', async () => {
  assert.equal((await report('daily', today, '2020-01-01')).status, 400, 'end before start');
  assert.equal((await report('daily', '2020-01-01', today)).status, 400, 'more than a year');
  assert.equal((await report('planes')).status, 400);
  const passenger = await fetch(`${base}/admin/exports/daily`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(passenger.status, 401);
});
