// Secrets that go inside web addresses (M-Pesa and USSD callbacks): one with characters that would break the address
// (Render's generated secrets are base64: + / =) is used as a hex hash of itself; a plain one is used as it is.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.MPESA_CALLBACK_SECRET = 'Ab/cd+EF==ghijklmnopqrstuvwxyz0123456789';
process.env.USSD_SECRET = 'plain-secret_0123456789abcdefghij';

const { config } = await import('../src/config.js');

test('a base64 secret becomes a hex token that fits in a web address', () => {
  const expected = createHash('sha256').update('Ab/cd+EF==ghijklmnopqrstuvwxyz0123456789').digest('hex');
  assert.equal(config.mpesa.callbackSecret, expected);
  assert.match(config.mpesa.callbackSecret, /^[0-9a-f]{64}$/);
});

test('a secret of letters, digits, - and _ is used as it is', () => {
  assert.equal(config.ussd.callbackSecret, 'plain-secret_0123456789abcdefghij');
});
