// Phase 7: passengers withdraw wallet money to M-Pesa; the office checks the M-Pesa statement against FarePay.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'mock';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { handleWithdrawalResult } = await import('../src/services/withdrawals.js');
const { parseCsv, readStatement } = await import('../src/services/statement.js');

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
const balance = async () => (await api('GET', '/passenger/wallet', { token: s.passenger })).body.balance;
const reconcile = async () => (await api('GET', '/admin/reconciliation', { token: s.admin })).body;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.admin = await login('0700000001', 'admin123');
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  s.passengerId = (await db.get("SELECT id FROM users WHERE phone = '254722333444'")).id;
  await tx(() => postWalletEntry(s.passengerId, { type: 'test_credit', amount: 500 }));
});
after(() => server.close());

test('a passenger withdraws to their own M-Pesa number; the wallet goes down and they are told', async () => {
  const info = (await api('GET', '/passenger/withdrawals', { token: s.passenger })).body;
  assert.deepEqual([info.balance, info.phone, info.min_amount], [500, '254722333444', 10]);

  const r = await api('POST', '/passenger/withdrawals', { token: s.passenger, body: { amount: 200, phone: '0799999999' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.withdrawal.phone, '254722333444', 'always the registered number, whatever is sent');
  assert.equal(r.body.withdrawal.status, 'completed'); // mock M-Pesa confirms at once
  assert.match(r.body.withdrawal.reference, /^MOCK/);
  assert.equal(r.body.withdrawal.conversation_id, undefined, 'internal ids are not shown to passengers');
  assert.equal(await balance(), 300);
  const n = (await api('GET', '/notifications', { token: s.passenger })).body.items[0];
  assert.equal(n.title, 'KES 200 sent to your M-Pesa');
  assert.equal((await reconcile()).all_ok, true);
});

test('limits: not more than the balance, not below the minimum, a few a day', async () => {
  assert.equal((await api('POST', '/passenger/withdrawals', { token: s.passenger, body: { amount: 301 } })).body.error.code, 'INSUFFICIENT_FUNDS');
  assert.equal((await api('POST', '/passenger/withdrawals', { token: s.passenger, body: { amount: 5 } })).body.error.code, 'AMOUNT_TOO_SMALL');
  assert.equal(await balance(), 300, 'a refused withdrawal takes nothing');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM withdrawals')).n, 1, 'and leaves no record');
  assert.equal((await api('POST', '/passenger/withdrawals', { token: s.passenger, body: { amount: 10 } })).status, 201);
  const third = await api('POST', '/passenger/withdrawals', { token: s.passenger, body: { amount: 10 } });
  assert.equal(third.status, 429);
  assert.equal(await balance(), 290);
  (await db.run("UPDATE withdrawals SET created_at = '2020-01-01T00:00:00.000Z'")); // as if they were on another day
});

test('M-Pesa refuses: the money goes back into the wallet and the passenger is told', async () => {
  const r = (await api('POST', '/passenger/withdrawals', { token: s.passenger, body: { amount: 90 } })).body.withdrawal;
  // Pretend this one is still waiting for M-Pesa, then M-Pesa says it failed.
  (await db.run("UPDATE withdrawals SET status = 'processing', reference = NULL, completed_at = NULL WHERE id = ?", r.id));
  const conversationId = (await db.get('SELECT conversation_id FROM withdrawals WHERE id = ?', r.id)).conversation_id;
  // (the wallet already went down by 90 when it was asked for)
  assert.equal(await handleWithdrawalResult({ OriginatorConversationID: conversationId, ResultCode: 2001, ResultDesc: 'The initiator information is invalid.' }), true);
  assert.equal(await balance(), 290);
  const w = (await api('GET', '/passenger/withdrawals', { token: s.passenger })).body.withdrawals[0];
  assert.equal(w.status, 'failed');
  assert.equal((await api('GET', '/notifications', { token: s.passenger })).body.items[0].title, 'Withdrawal of KES 90 not sent');
  assert.equal((await reconcile()).all_ok, true, 'the reversal keeps the books balanced');
  assert.equal(await handleWithdrawalResult({ OriginatorConversationID: 'not-a-withdrawal', ResultCode: 0 }), false);
});

test('when automatic payouts are off, the office sends it and records the M-Pesa code (or marks it failed)', async () => {
  const manualWithdrawal = () =>
    tx(async () => {
      const id = await db.insert("INSERT INTO withdrawals (user_id, phone, amount, status, conversation_id) VALUES (?, '254722333444', 20, 'manual', ?)", s.passengerId, crypto.randomUUID());
      await postWalletEntry(s.passengerId, { type: 'withdrawal', amount: -20, reference: `W${id}` });
      return id;
    });
  const a = await manualWithdrawal();
  const b = await manualWithdrawal();
  const queue = (await api('GET', '/admin/withdrawals', { token: s.admin })).body;
  assert.deepEqual(queue.open.map((w) => [w.id, w.passenger_name]), [[a, 'Pat'], [b, 'Pat']]);

  const sent = await api('POST', `/admin/withdrawals/${a}/complete`, { token: s.admin, body: { reference: 'sjk12abc9' } });
  assert.equal(sent.body.reference, 'SJK12ABC9');
  assert.equal(sent.body.handled_by_name, 'Office');
  assert.equal((await api('POST', `/admin/withdrawals/${a}/fail`, { token: s.admin, body: { reason: 'Oops' } })).status, 409, 'finished ones stay finished');

  await api('POST', `/admin/withdrawals/${b}/fail`, { token: s.admin, body: { reason: 'Number not registered for M-Pesa' } });
  assert.equal(await balance(), 270, '290 - 20 sent; the failed 20 came back');
  const check = await reconcile();
  assert.equal(check.all_ok, true, JSON.stringify(check.checks.filter((c) => !c.ok)));
  assert.equal(check.totals.withdrawn_to_mpesa, 200 + 10 + 20);
  assert.equal((await api('GET', '/admin/withdrawals', { token: s.passenger })).status, 403);
});

test('passengers with money left are pointed to Withdraw before deleting their account', async () => {
  const r = await api('POST', '/auth/delete-account', { token: s.passenger, body: { password: 'pass123' } });
  assert.equal(r.body.error.code, 'WALLET_NOT_EMPTY');
  assert.match(r.body.error.message, /Withdraw it to M-Pesa/);
});

// ---------- Statement check ----------

test('CSV reading copes with quotes, commas inside amounts and Windows line ends', async () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,"1,000.00",x'), [['a', 'b, c', 'say "hi"'], ['1', '1,000.00', 'x']]);
  assert.throws(() => readStatement('name,amount\nx,1'), /does not look like an M-Pesa statement/);
});

test('the statement is matched receipt by receipt, and every difference is listed', async () => {
  // FarePay's side: two top-ups confirmed by M-Pesa, and a payout sent with a code.
  const insertPayment = (...values) =>
    db.run("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, mpesa_receipt, completed_at) VALUES (?, '254722333444', ?, 'wallet', 'completed', ?, ?)", ...values);
  await insertPayment(s.passengerId, 100, 'TJA1111111', '2026-10-10T07:00:00.000Z');
  await insertPayment(s.passengerId, 50, 'TJA2222222', '2026-10-10T08:00:00.000Z');
  await insertPayment(s.passengerId, 70, 'TJA3333333', '2026-10-10T09:00:00.000Z'); // missing from the statement
  (await db.run("INSERT INTO payouts (owner_name, owner_phone, amount, trip_count, status, conversation_id, reference, completed_at) VALUES ('Mary', '254744555666', 400, 8, 'completed', 'c1', 'TJB4444444', '2026-10-10T18:00:00.000Z')"));

  const csv = [
    'Account Holder:,FAREPAY SACCO',
    'Short Code:,600000',
    '',
    'Receipt No.,Completion Time,Initiation Time,Details,Transaction Status,Paid In,Withdrawn,Balance,Balance Confirmed,Reason Type,Other Party Info,Linked Transaction ID,A/C No.',
    'TJA1111111,2026-10-10 10:00:01,2026-10-10 10:00:00,Pay Bill from 2547******44 - PAT,Completed,100.00,,100.00,true,Pay Bill Online,2547******44 - PAT,,FarePay',
    'TJA2222222,2026-10-10 11:00:01,2026-10-10 11:00:00,Pay Bill from 2547******44 - PAT,Completed,55.00,,155.00,true,Pay Bill Online,2547******44 - PAT,,FarePay',
    'TJA9999999,2026-10-10 12:00:01,2026-10-10 12:00:00,Pay Bill from 2547******99 - SOMEONE,Completed,"1,000.00",,1155.00,true,Pay Bill Online,2547******99,,',
    'TJB4444444,2026-10-10 21:00:05,2026-10-10 21:00:00,Business Payment to 2547******66 - MARY,Completed,,-400.00,755.00,true,Business Payment,2547******66 - MARY,,',
    'TJB4444445,2026-10-10 21:00:05,2026-10-10 21:00:00,Business Payment Charge,Completed,,-15.00,740.00,true,Business Payment Charge,,,',
    'TJC0000000,2026-10-10 22:00:00,2026-10-10 22:00:00,Pay Bill from 2547******44 - PAT,Cancelled,20.00,,740.00,true,Pay Bill Online,,,',
  ].join('\r\n');

  const r = await api('POST', '/admin/statement-check', { token: s.admin, body: { csv } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.deepEqual(d.period, { from: '2026-10-10T07:00:01.000Z', to: '2026-10-10T18:00:05.000Z' });
  assert.equal(d.transactions, 5, 'the cancelled one is ignored');
  assert.deepEqual([d.money_in.matched, d.money_in.amount], [1, 100]);
  assert.deepEqual(d.money_in.wrong_amount, [{ receipt: 'TJA2222222', statement: 55, farepay: 50 }]);
  assert.deepEqual(d.money_in.not_in_farepay.map((x) => [x.receipt, x.amount]), [['TJA9999999', 1000]]);
  assert.deepEqual([d.money_out.matched, d.money_out.amount], [1, 400]);
  assert.deepEqual(d.charges, { count: 1, amount: 15 });
  assert.deepEqual(d.not_in_statement.map((x) => [x.receipt, x.amount, x.what]), [['TJA3333333', 70, 'wallet top-up']]);
  assert.equal(d.all_ok, false);

  const log = (await api('GET', '/admin/audit?limit=5', { token: s.admin })).body.items;
  const entry = log.find((e) => e.action === 'POST /admin/statement-check');
  assert.ok(entry, 'the check is in the audit log');
  assert.match(JSON.stringify(entry.details), /\[\d+ characters\]/, 'but not the whole statement');
});

test('a file that is not a statement gets a clear message', async () => {
  const r = await api('POST', '/admin/statement-check', { token: s.admin, body: { csv: 'hello,world' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'BAD_STATEMENT');
});
