// Refunds and withdrawals to M-Pesa when Safaricom can't be reached at all: nothing was sent, so they are tried again
// automatically (later and later) until M-Pesa takes them; after the last try the office sends it by hand. When the
// request may have reached Safaricom, it is never sent again automatically (no money sent twice).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test';
process.env.MPESA_MODE = 'sandbox';
process.env.MPESA_CONSUMER_KEY = 'key';
process.env.MPESA_CONSUMER_SECRET = 'secret';
process.env.MPESA_SHORTCODE = '174379';
process.env.MPESA_PASSKEY = 'passkey';
process.env.MPESA_B2C_SHORTCODE = '600000';
process.env.MPESA_B2C_INITIATOR_NAME = 'testapi';
process.env.MPESA_B2C_SECURITY_CREDENTIAL = 'credential';
process.env.MAX_WITHDRAWALS_PER_DAY = '5';

const { createUser } = await import('../src/services/users.js');
const { db, tx } = await import('../src/database.js');
const { postWalletEntry } = await import('../src/services/wallet.js');
const { getWithdrawal, handleWithdrawalResult, requestWithdrawal, retryUnsentWithdrawals } = await import('../src/services/withdrawals.js');

// A fake Safaricom: 'down' (can't connect: nothing reaches it), 'up', or 'lost' (connected, then the answer was lost).
let safaricom = 'down';
const b2cRequests = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (safaricom === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (path.startsWith('/oauth')) return Response.json({ access_token: 'token', expires_in: '3599' });
    b2cRequests.push(path);
    if (safaricom === 'lost') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
    return Response.json({ ResponseCode: '0', ConversationID: `AG_${b2cRequests.length}`, OriginatorConversationID: 'x' });
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

let pat;
const balance = async () => (await db.get('SELECT balance FROM wallets WHERE user_id = ?', pat.id)).balance;
// As if the clock had moved on to the next try.
const nextTryIsDue = (id) => db.run('UPDATE withdrawals SET next_try_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), id);

before(async () => {
  pat = await createUser({ name: 'Pat', phone: '254722000001', password: 'Apass123', role: 'passenger' });
  await createUser({ name: 'Office', phone: '254700000001', password: 'admin123', role: 'admin' });
  await tx(() => postWalletEntry(pat.id, { type: 'test_credit', amount: 1000 }));
});

test('M-Pesa out of reach: nothing sent, still on its way, tried again later until M-Pesa takes it', async () => {
  const w = await requestWithdrawal(pat, 100);
  assert.equal(w.status, 'processing');
  assert.equal(w.send_attempts, 1);
  assert.ok(Date.parse(w.next_try_at) > Date.now(), 'the next try is later');
  assert.match(w.result_desc, /Nothing was sent; trying again automatically/);
  assert.equal(await balance(), 900, 'the money stays out of the wallet meanwhile');

  assert.equal(await retryUnsentWithdrawals(), 0, 'not before its time');
  await nextTryIsDue(w.id);
  await retryUnsentWithdrawals();
  assert.equal((await getWithdrawal(w.id)).send_attempts, 2, 'still out of reach: tried again, waits longer');
  assert.deepEqual(b2cRequests, []);

  safaricom = 'up';
  await nextTryIsDue(w.id);
  await retryUnsentWithdrawals();
  assert.deepEqual(b2cRequests, ['/mpesa/b2c/v3/paymentrequest'], 'sent once');
  const sent = await getWithdrawal(w.id);
  assert.equal(sent.next_try_at, null);
  assert.equal(sent.provider_reference, 'AG_1');
  await retryUnsentWithdrawals();
  assert.equal(b2cRequests.length, 1, 'never sent twice');

  await handleWithdrawalResult({ ResultCode: 0, ResultDesc: 'ok', OriginatorConversationID: sent.conversation_id, TransactionID: 'SBX123' });
  assert.equal((await getWithdrawal(w.id)).status, 'completed');
  assert.equal(await balance(), 900);
});

test('if the request may have reached M-Pesa, it is not sent again: the office checks', async () => {
  safaricom = 'lost';
  const w = await requestWithdrawal(pat, 50);
  assert.equal(w.next_try_at, null, 'no automatic retry');
  assert.match(w.result_desc, /Result unknown/);
  await retryUnsentWithdrawals();
  assert.equal(b2cRequests.length, 2, 'sent only the once');
  const office = await db.get("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'withdrawal.unknown'");
  assert.equal(office.n, 1, 'the office is asked to check');
  await db.run("UPDATE withdrawals SET status = 'failed' WHERE id = ?", w.id); // the office's check, for the next test
});

test('after the last try, the office is asked to send it by hand', async () => {
  safaricom = 'down';
  const w = await requestWithdrawal(pat, 70);
  for (let i = 0; i < 10; i++) {
    await nextTryIsDue(w.id);
    await retryUnsentWithdrawals();
  }
  const last = await getWithdrawal(w.id);
  assert.equal(last.status, 'manual');
  assert.equal(last.send_attempts, 11, 'the first try and 10 more');
  assert.match(last.result_desc, /Nothing was sent: send it by hand/);
  const office = await db.get("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'withdrawal.manual'");
  assert.equal(office.n, 1);
});
