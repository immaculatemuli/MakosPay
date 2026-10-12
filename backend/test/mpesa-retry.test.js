// Connecting to Safaricom sometimes times out on a slow network. Such a request was never sent, so it is tried
// once more; a failure after connecting (the request may have reached Safaricom) is never repeated.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.MPESA_MODE = 'sandbox';
process.env.MPESA_CONSUMER_KEY = 'key';
process.env.MPESA_CONSUMER_SECRET = 'secret';
process.env.MPESA_SHORTCODE = '174379';
process.env.MPESA_PASSKEY = 'passkey';

const mpesa = await import('../src/services/mpesa.js');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const networkError = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** A fake Safaricom whose first `failures` answers are the given errors. Records each request's path. */
function fakeSafaricom(failures) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (failures.length) throw failures.shift();
    if (path.startsWith('/oauth')) return json({ access_token: 'token', expires_in: '3599' });
    return json({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_1', MerchantRequestID: 'm1' });
  };
  return calls;
}

const push = () => mpesa.stkPush({ phone: '254708374149', amount: 10, accountReference: 'KDA123A', description: 'Fare' });

test('a connection that times out is tried again, and the PIN prompt is sent once', async () => {
  const calls = fakeSafaricom([networkError('UND_ERR_CONNECT_TIMEOUT')]);
  const res = await push();
  assert.equal(res.CheckoutRequestID, 'ws_CO_1');
  assert.equal(calls.filter((p) => p.includes('stkpush')).length, 1);
});

test('a failure after connecting is not repeated (the prompt may already be on the phone)', async () => {
  fakeSafaricom([]);
  await push(); // signs in to Safaricom first, so the next push goes straight to the prompt
  const after = fakeSafaricom([networkError('UND_ERR_SOCKET')]);
  await assert.rejects(push, /fetch failed/);
  assert.deepEqual(after, ['/mpesa/stkpush/v1/processrequest']);
});

test('it gives up after the second failed connection', async () => {
  const calls = fakeSafaricom([networkError('UND_ERR_CONNECT_TIMEOUT'), networkError('UND_ERR_CONNECT_TIMEOUT')]);
  await assert.rejects(push, /fetch failed/);
  assert.equal(calls.length, 2);
});
