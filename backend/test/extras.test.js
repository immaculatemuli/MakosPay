// Refunds, bank payouts, office staff accounts and passenger account deletion
// (against a local fake of Safaricom's B2C/B2B API).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

const fake = { b2c: [], b2b: [] };
const daraja = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const send = (data) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (req.url.startsWith('/oauth/v1/generate')) return send({ access_token: 'tok', expires_in: '3599' });
  const body = JSON.parse(raw);
  if (req.url === '/mpesa/b2c/v3/paymentrequest') {
    fake.b2c.push(body);
    return send({ OriginatorConversationID: body.OriginatorConversationID, ConversationID: `AG_C${fake.b2c.length}`, ResponseCode: '0' });
  }
  if (req.url === '/mpesa/b2b/v1/paymentrequest') {
    fake.b2b.push(body);
    // Daraja picks its own OriginatorConversationID for B2B.
    return send({ OriginatorConversationID: `B2B-ORIG-${fake.b2b.length}`, ConversationID: `AG_B${fake.b2b.length}`, ResponseCode: '0' });
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => daraja.listen(0, resolve));

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'sandbox';
process.env.MPESA_BASE_URL = `http://127.0.0.1:${daraja.address().port}`;
process.env.MPESA_CONSUMER_KEY = 'key';
process.env.MPESA_CONSUMER_SECRET = 'secret';
process.env.MPESA_PASSKEY = 'pk';
process.env.MPESA_CALLBACK_SECRET = 'cbsecret';
process.env.MPESA_B2C_SHORTCODE = '600989';
process.env.MPESA_B2C_INITIATOR_NAME = 'testapi';
process.env.MPESA_B2C_SECURITY_CREDENTIAL = 'cred';

const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/db.js');
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
const pay = async (vehicle) =>
  (await api('POST', '/passenger/pay', { token: s.passenger, body: { qr: vehicle.qr_token, stop_id: s.stop.id, expected_fare: 70, idempotency_key: randomUUID() } })).body.trip;
const balance = async () => (await api('GET', '/passenger/wallet', { token: s.passenger })).body.balance;
const owed = async (ownerPhone) => (await api('GET', '/admin/payouts/owed', { token: s.admin })).body.owners.find((o) => o.owner_phone === ownerPhone);
const result = (conversationId, ok = true, path = 'b2c') =>
  api('POST', `/mpesa/callback/cbsecret/${path}/result`, {
    body: { Result: ok ? { ResultCode: 0, OriginatorConversationID: conversationId, TransactionID: 'TX123' } : { ResultCode: 1, OriginatorConversationID: conversationId, ResultDesc: 'Failed' } },
  });

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const me = await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  s.adminId = me.id;
  s.admin = (await api('POST', '/auth/login', { body: { phone: '0700000001', password: 'admin123' } })).body.token;
  const route = (await api('POST', '/admin/routes', { token: s.admin, body: { name: 'Thika Road', origin: 'Town', stops: [{ name: 'Juja', cash_fare: 80, app_fare: 70 }] } })).body;
  s.stop = route.stops[0];
  s.routeId = route.id;
  s.mpesaVehicle = (await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDA 111A', owner_name: 'Mary', owner_phone: '0744555666', route_id: route.id } })).body;
  s.passenger = (await api('POST', '/auth/register', { body: { name: 'Pat', phone: '0722333444', password: 'pass123' } })).body.token;
  s.passengerId = db.prepare("SELECT id FROM users WHERE phone = '254722333444'").get().id;
  tx(() => postWalletEntry(s.passengerId, { type: 'test_credit', amount: 1000 }));
});
after(() => {
  server.close();
  daraja.close();
});

test('refund before the owner is paid: money back to the wallet, left out of the payout', async () => {
  const keep = await pay(s.mpesaVehicle);
  const refund = await pay(s.mpesaVehicle);
  assert.equal(await balance(), 860);

  const r = await api('POST', `/admin/payments/${refund.id}/refund`, { token: s.admin, body: { reason: 'Vehicle broke down' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'refunded');
  assert.equal(await balance(), 930);
  assert.equal((await api('POST', `/admin/payments/${refund.id}/refund`, { token: s.admin, body: { reason: 'again' } })).status, 409, 'only once');

  const txs = (await api('GET', '/passenger/wallet/transactions', { token: s.passenger })).body.items;
  assert.deepEqual([txs[0].type, txs[0].amount, txs[0].reference], ['refund', 70, refund.ticket_code]);

  assert.equal((await owed('254744555666')).amount, 70, 'only the kept fare is owed');
  const summary = (await api('GET', '/admin/payments', { token: s.admin })).body.summary;
  assert.deepEqual([summary.payments, summary.total], [1, 70], 'refunded fare not counted in takings');

  const p = (await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0744555666' } })).body;
  assert.equal(p.amount, 70);
  await result(p.conversation_id);
  s.paidTrip = keep;
});

test('refund after the owner was paid: taken off their next payout', async () => {
  await api('POST', `/admin/payments/${s.paidTrip.id}/refund`, { token: s.admin, body: { reason: 'Charged twice' } });
  assert.equal(await owed('254744555666'), undefined, 'owes nothing yet: the refund is waiting');
  await pay(s.mpesaVehicle);
  await pay(s.mpesaVehicle);
  const o = await owed('254744555666');
  assert.deepEqual([o.fares, o.deducted, o.amount], [140, 70, 70]);
  const p = (await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0744555666' } })).body;
  assert.equal(p.amount, 70);

  // If that payout fails, the deduction waits for the next one again.
  await result(p.conversation_id, false);
  assert.equal((await owed('254744555666')).amount, 70);
});

test('conductor ticket check shows a refunded ticket as refunded', async () => {
  const c = (await api('POST', '/admin/conductors', { token: s.admin, body: { name: 'Ian', phone: '0711111111', password: 'cond123' } })).body;
  await api('PATCH', `/admin/vehicles/${s.mpesaVehicle.id}`, { token: s.admin, body: { conductor_id: c.id } });
  const conductor = (await api('POST', '/auth/login', { body: { phone: '0711111111', password: 'cond123' } })).body.token;
  const r = await api('GET', `/conductor/tickets/${s.paidTrip.ticket_code}`, { token: conductor });
  assert.equal(r.body.refunded, true);
});

test('bank owner: details are required and the payout goes to the bank paybill with the account number', async () => {
  const missing = await api('POST', '/admin/vehicles', { token: s.admin, body: { plate: 'KDB 222B', owner_name: 'John', owner_phone: '0755666777', owner_payout_method: 'bank' } });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.error.details.map((d) => d.field).sort(), ['owner_bank_account', 'owner_bank_name', 'owner_bank_paybill']);

  const v = await api('POST', '/admin/vehicles', {
    token: s.admin,
    body: {
      plate: 'KDB 222B',
      owner_name: 'John',
      owner_phone: '0755666777',
      owner_payout_method: 'bank',
      owner_bank_name: 'Equity Bank',
      owner_bank_paybill: '247247',
      owner_bank_account: '0123456789',
      route_id: s.routeId,
    },
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  await pay(v.body);

  const o = await owed('254755666777');
  assert.deepEqual([o.method, o.bank_name, o.bank_paybill, o.bank_account], ['bank', 'Equity Bank', '247247', '0123456789']);

  const p = (await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0755666777' } })).body;
  assert.equal(p.status, 'processing');
  assert.equal(p.method, 'bank');
  const sent = fake.b2b.at(-1);
  assert.deepEqual([sent.CommandID, sent.PartyB, sent.AccountReference, sent.Amount], ['BusinessPayBill', '247247', '0123456789', 70]);
  assert.match(sent.ResultURL, /\/b2b\/result$/);
  assert.equal(p.conversation_id, 'B2B-ORIG-1', "stored Daraja's id to match the result");

  await result(p.conversation_id, true, 'b2b');
  assert.equal((await api('GET', `/admin/payouts/${p.id}`, { token: s.admin })).body.status, 'completed');
});

test('switching an owner back to M-Pesa pays them by B2C to their phone', async () => {
  const v = (await api('GET', '/admin/vehicles', { token: s.admin })).body.find((x) => x.plate === 'KDB 222B');
  const r = await api('PATCH', `/admin/vehicles/${v.id}`, { token: s.admin, body: { owner_payout_method: 'mpesa' } });
  assert.equal(r.body.owner_payout_method, 'mpesa');
  await pay(r.body);
  const sentBefore = fake.b2c.length;
  await api('POST', '/admin/payouts', { token: s.admin, body: { owner_phone: '0755666777' } });
  assert.equal(fake.b2c.length, sentBefore + 1);
  assert.equal(fake.b2c.at(-1).PartyB, '254755666777');
});

test('office staff: add another office account; it can sign in; nobody can switch themselves off', async () => {
  const add = await api('POST', '/admin/staff', { token: s.admin, body: { name: 'Second Clerk', phone: '0700000002', password: 'clerk123' } });
  assert.equal(add.status, 201);
  const login = await api('POST', '/auth/login', { body: { phone: '0700000002', password: 'clerk123' } });
  assert.equal(login.body.user.role, 'admin');
  assert.deepEqual((await api('GET', '/admin/staff', { token: s.admin })).body.map((x) => x.name).sort(), ['Office', 'Second Clerk']);

  assert.equal((await api('PATCH', `/admin/staff/${s.adminId}`, { token: s.admin, body: { is_active: false } })).status, 400);
  await api('PATCH', `/admin/staff/${add.body.id}`, { token: s.admin, body: { is_active: false } });
  assert.equal((await api('POST', '/auth/login', { body: { phone: '0700000002', password: 'clerk123' } })).status, 403);
});

test('a passenger can delete their account once the wallet is empty', async () => {
  const blocked = await api('POST', '/auth/delete-account', { token: s.passenger, body: { password: 'pass123' } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'WALLET_NOT_EMPTY');

  db.prepare('UPDATE wallets SET balance = 0 WHERE user_id = ?').run(s.passengerId);
  assert.equal((await api('POST', '/auth/delete-account', { token: s.passenger, body: { password: 'wrong' } })).status, 400);
  const ok = await api('POST', '/auth/delete-account', { token: s.passenger, body: { password: 'pass123' } });
  assert.equal(ok.status, 200);

  assert.equal((await api('POST', '/auth/login', { body: { phone: '0722333444', password: 'pass123' } })).status, 401);
  assert.equal((await api('GET', '/auth/me', { token: s.passenger })).status, 401, 'signed out everywhere');
  const row = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(s.passengerId);
  assert.deepEqual({ ...row }, { name: 'Deleted passenger', phone: `deleted-${s.passengerId}` });
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM trips WHERE passenger_id = ?').get(s.passengerId).n > 0, 'payment records kept');

  // The number can be used again for a new account.
  assert.equal((await api('POST', '/auth/register', { body: { name: 'New Pat', phone: '0722333444', password: 'pass123' } })).status, 201);
});
