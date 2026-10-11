// Audit: the app can never change a wallet balance itself, and repeated or replayed M-Pesa callbacks can
// never credit a wallet twice. Everything goes through real HTTP requests, as a phone (or attacker) would.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const s = {};
const balanceOf = async (userId) => (await db.get('SELECT balance FROM wallets WHERE user_id = ?', userId)).balance;
const entries = async (reference) => (await db.get('SELECT COUNT(*) AS n FROM wallet_transactions WHERE reference = ?', reference)).n;
const stkSuccess = (checkoutId, receipt) => ({
  Body: { stkCallback: { CheckoutRequestID: checkoutId, ResultCode: 0, ResultDesc: 'ok', CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: receipt }] } } },
});
/** A PIN prompt that was sent and is waiting for M-Pesa's answer. */
const pending = async (userId, amount, checkoutId, status = 'pending', resultDesc = null) =>
  (await db.run("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, checkout_request_id, result_desc) VALUES (?, '254722333444', ?, 'wallet', ?, ?, ?)", userId, amount, status, checkoutId, resultDesc));

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  const reg = await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123', role: 'admin', balance: 100000 } });
  s.pat = reg.body.token;
  s.patId = reg.body.user.id;
  assert.equal(reg.body.user.role, 'passenger', 'signing up can never pick a role');
  const other = await api('POST', '/auth/register', { body: { name: 'Olive', phone: '0722333555', password: 'pass123' } });
  s.oliveId = other.body.user.id;
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Ruiru', cash_fare: 60, app_fare: 50 }] } })).body;
  s.stop = route.stops[0];
  s.vehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 123A', owner_name: 'Mary', owner_phone: '0744555666', route_id: route.id } })).body;
});
after(() => server.close());

// ---------- The app cannot change a balance ----------

test('a new account starts at KES 0, whatever the sign-up request says', async () => {
  assert.equal(await balanceOf(s.patId), 0);
});

test('there is no way to write a balance: no such endpoints, for passengers or the office', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await api(method, '/passenger/wallet', { token: s.pat, body: { balance: 100000 } })).status, 404, `${method} /passenger/wallet`);
    assert.equal((await api(method, `/admin/wallets/${s.patId}`, { token: s.admin, body: { balance: 100000 } })).status, 404, `${method} /admin/wallets`);
  }
  assert.equal(await balanceOf(s.patId), 0);
});

test('a top-up credits only the amount M-Pesa confirmed, only to the signed-in passenger', async () => {
  const r = await api('POST', '/passenger/wallet/topup', { token: s.pat, body: { amount: 50, balance: 99999, user_id: s.oliveId, credit: 5000 } });
  assert.equal(r.status, 202);
  assert.equal(await balanceOf(s.patId), 50); // mock M-Pesa confirms at once
  assert.equal(await balanceOf(s.oliveId), 0);
});

test('negative or zero amounts, and paying less than the fare, are refused without touching the wallet', async () => {
  assert.equal((await api('POST', '/passenger/wallet/topup', { token: s.pat, body: { amount: -500 } })).status, 400);
  assert.equal((await api('POST', '/passenger/withdrawals', { token: s.pat, body: { amount: -500 } })).status, 400);
  assert.equal((await api('POST', '/passenger/withdrawals', { token: s.pat, body: { amount: 0 } })).status, 400);
  const cheap = await api('POST', '/passenger/pay', { token: s.pat, body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: 1, idempotency_key: randomUUID() } });
  assert.notEqual(cheap.status, 201);
  assert.equal(await balanceOf(s.patId), 50);
});

test('paying the same fare twice (a double tap or retry) charges once', async () => {
  const key = randomUUID();
  const pay = () => api('POST', '/passenger/pay', { token: s.pat, body: { qr: s.vehicle.qr_token, stop_id: s.stop.id, expected_fare: 50, idempotency_key: key } });
  const [a, b] = await Promise.all([pay(), pay()]);
  assert.equal(a.body.trip.ticket_code, b.body.trip.ticket_code);
  assert.equal(await balanceOf(s.patId), 0);
});

test('only the office can refund, and only real payments', async () => {
  assert.equal((await api('POST', '/admin/payments/1/refund', { token: s.pat, body: { reason: 'give me money' } })).status, 403);
  assert.equal((await api('POST', '/admin/payments/999/refund', { token: s.admin, body: { reason: 'no such fare' } })).status, 404);
  assert.equal(await balanceOf(s.patId), 0);
});

test('the database itself refuses a negative balance', async () => {
  await assert.rejects(db.run('UPDATE wallets SET balance = -1 WHERE user_id = ?', s.patId), /check constraint/i);
});

// ---------- M-Pesa callbacks ----------

test('a forged callback (without the secret in the address) is ignored', async () => {
  await pending(s.patId, 100, 'ws_forged');
  for (const path of ['/hooks/guess/stk', '/mpesa/callback/guess/stk']) {
    assert.equal((await api('POST', path, { body: stkSuccess('ws_forged', 'FORGED01') })).status, 404);
  }
  assert.equal(await balanceOf(s.patId), 0);
  assert.equal((await db.get("SELECT status FROM mpesa_payments WHERE checkout_request_id = 'ws_forged'")).status, 'pending');
});

test('the same success callback delivered 5 times at once credits the wallet once', async () => {
  await pending(s.patId, 100, 'ws_dup');
  const results = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/hooks/cbsecret/stk', { body: stkSuccess('ws_dup', 'RCPT0001') })));
  assert.ok(results.every((r) => r.status === 200 && r.body.ResultCode === 0), 'Safaricom always gets "Accepted"');
  assert.equal(await balanceOf(s.patId), 100);
  assert.equal(await entries('RCPT0001'), 1);

  // A failure arriving afterwards changes nothing.
  await api('POST', '/hooks/cbsecret/stk', { body: { Body: { stkCallback: { CheckoutRequestID: 'ws_dup', ResultCode: 1032, ResultDesc: 'Cancelled' } } } });
  assert.equal(await balanceOf(s.patId), 100);
  assert.equal((await db.get("SELECT status FROM mpesa_payments WHERE checkout_request_id = 'ws_dup'")).status, 'completed');
});

test('a receipt replayed onto another waiting payment credits nothing', async () => {
  await pending(s.patId, 100, 'ws_replay');
  const r = await api('POST', '/hooks/cbsecret/stk', { body: stkSuccess('ws_replay', 'RCPT0001') });
  assert.equal(r.body.ResultCode, 0);
  assert.equal(await balanceOf(s.patId), 100, 'one receipt, one credit');
  assert.equal(await entries('RCPT0001'), 1);
  assert.equal((await db.get("SELECT status FROM mpesa_payments WHERE checkout_request_id = 'ws_replay'")).status, 'pending');
});

test('a callback for a payment FarePay never sent credits nothing', async () => {
  await api('POST', '/hooks/cbsecret/stk', { body: stkSuccess('ws_unknown', 'RCPT0002') });
  assert.equal(await entries('RCPT0002'), 0);
});

test('M-Pesa confirming late (after FarePay gave up waiting) credits the wallet once', async () => {
  await pending(s.patId, 30, 'ws_late', 'failed', 'No answer from M-Pesa (expired)');
  await api('POST', '/hooks/cbsecret/stk', { body: stkSuccess('ws_late', 'RCPT0003') });
  await api('POST', '/hooks/cbsecret/stk', { body: stkSuccess('ws_late', 'RCPT0003') });
  assert.equal(await balanceOf(s.patId), 130);
  assert.equal(await entries('RCPT0003'), 1);
  // A real M-Pesa failure (cancelled by the passenger) is final: a later "success" can't credit it.
  await pending(s.patId, 30, 'ws_cancelled', 'failed', 'Request cancelled by user');
  await api('POST', '/hooks/cbsecret/stk', { body: stkSuccess('ws_cancelled', 'RCPT0004') });
  assert.equal(await balanceOf(s.patId), 130);
});

test('a repeated "withdrawal failed" result returns the money once', async () => {
  const w = (await db.insert("INSERT INTO withdrawals (user_id, phone, amount, status, conversation_id) VALUES (?, '254722333444', 40, 'processing', 'conv-w1')", s.patId));
  (await db.run("UPDATE wallets SET balance = balance - 40 WHERE user_id = ?", s.patId));
  (await db.run("INSERT INTO wallet_transactions (user_id, type, amount, balance_after, reference) VALUES (?, 'withdrawal', -40, ?, ?)", s.patId, await balanceOf(s.patId), `W${w}`));
  const result = { Result: { OriginatorConversationID: 'conv-w1', ResultCode: 2001, ResultDesc: 'Invalid initiator' } };
  await Promise.all([1, 2, 3].map(() => api('POST', '/hooks/cbsecret/b2c/result', { body: result })));
  assert.equal(await balanceOf(s.patId), 130);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM wallet_transactions WHERE type = 'withdrawal_reversal'")).n, 1);
});

test('after all of that, the money check still balances', async () => {
  const check = (await api('GET', '/admin/reconciliation', { token: s.admin })).body;
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
});
