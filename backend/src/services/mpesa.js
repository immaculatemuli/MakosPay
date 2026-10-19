// M-Pesa payments: Safaricom Daraja directly, or IntaSend when PAYMENT_PROVIDER=intasend.
// In mock mode nothing leaves the server; callers simulate the asynchronous callbacks
// themselves using the mock* helpers below.
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { mpesaTimestamp } from '../util.js';
import * as intasend from './intasend.js';

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

const cfg = config.mpesa;
export const isMock = cfg.mode === 'mock';
const viaIntaSend = !isMock && config.paymentProvider === 'intasend';
const baseUrl = cfg.baseUrlOverride ?? BASE_URLS[cfg.mode];

/** e.g. "IntaSend (live)" or "Safaricom Daraja (sandbox)", for logs and the admin dashboard. */
export const providerLabel = isMock
  ? 'mock (no money moves)'
  : viaIntaSend
    ? `IntaSend (${config.intasend.mode})`
    : `Safaricom Daraja (${cfg.mode})`;

/** Which real-money features have credentials. In mock mode everything "works" without money moving. */
export const isConfigured = viaIntaSend
  ? { stk: intasend.isConfigured, b2c: intasend.isConfigured }
  : {
      stk: isMock || Boolean(cfg.consumerKey && cfg.consumerSecret && cfg.shortcode && cfg.passkey),
      b2c: isMock || Boolean(cfg.consumerKey && cfg.consumerSecret && cfg.b2cShortcode && cfg.b2cInitiatorName && cfg.b2cSecurityCredential),
    };
// Safaricom refuses callback addresses containing words like "mpesa" or "safaricom", so they go to /hooks.
const callbackUrl = (path) => `${cfg.callbackBaseUrl}/hooks/${cfg.callbackSecret}/${path}`;

// Failures before a connection to Safaricom exists: the request was never sent, so trying again can't send a
// PIN prompt or payment twice. (Connecting to Safaricom can take over 10 seconds on a slow network.)
const NOT_CONNECTED = new Set(['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/** fetch to Safaricom, trying once more if the connection itself could not be made. */
async function darajaFetch(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      // notSent: Safaricom never got this request (so a payment can safely be tried again later).
      if (NOT_CONNECTED.has(err.cause?.code)) err.notSent = true;
      if (attempt >= 2 || !err.notSent) throw err;
      console.warn(`[mpesa] could not connect to Safaricom (${err.cause.code}), trying again`);
    }
  }
}

let cachedToken = null; // { value, expiresAt }

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  const res = await darajaFetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Daraja auth failed: HTTP ${res.status}`);
  const data = await res.json();
  // Refresh a minute before Safaricom expires it.
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
  return cachedToken.value;
}

async function post(path, body) {
  // Signing in to Safaricom failed: the request itself was never sent.
  const token = await accessToken().catch((err) => {
    err.notSent = true;
    throw err;
  });
  const res = await darajaFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.ResponseCode !== undefined && String(data.ResponseCode) !== '0')) {
    const err = new Error(data.errorMessage || data.ResponseDescription || `HTTP ${res.status}`);
    // Safaricom answered and refused, so we know no money moved (unlike a network timeout).
    err.rejected = true;
    throw err;
  }
  return data;
}

/** Sends the "enter your M-Pesa PIN" prompt to the customer's phone. */
export async function stkPush({ phone, amount, accountReference, description }) {
  if (viaIntaSend) return intasend.stkPush({ phone, amount, accountReference });
  if (isMock) {
    return { MerchantRequestID: `mock-${randomUUID()}`, CheckoutRequestID: `ws_CO_MOCK_${randomUUID()}`, ResponseCode: '0' };
  }
  const timestamp = mpesaTimestamp();
  return post('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: cfg.shortcode,
    Password: Buffer.from(`${cfg.shortcode}${cfg.passkey}${timestamp}`).toString('base64'),
    Timestamp: timestamp,
    TransactionType: cfg.transactionType,
    Amount: amount,
    PartyA: phone,
    PartyB: cfg.partyB,
    PhoneNumber: phone,
    CallBackURL: callbackUrl('stk'),
    AccountReference: accountReference.slice(0, 12),
    TransactionDesc: description.slice(0, 13),
  });
}

/**
 * Asks Safaricom for the outcome of an STK push. Lets us confirm top-ups even when the
 * callback cannot reach us (e.g. running on a laptop without a public URL).
 * Throws while the customer has not yet answered the prompt.
 */
export async function stkQuery(checkoutRequestId) {
  if (viaIntaSend) return intasend.stkQuery(checkoutRequestId);
  const timestamp = mpesaTimestamp();
  return post('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: cfg.shortcode,
    Password: Buffer.from(`${cfg.shortcode}${cfg.passkey}${timestamp}`).toString('base64'),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  });
}

/**
 * Sends money to an M-Pesa number. Returns { providerReference }: IntaSend's tracking id, or
 * Daraja's ConversationID (Daraja reports the outcome by callback instead).
 */
export async function b2cPayment({ originatorConversationId, phone, amount, remarks, name, occasion = 'Owner payout' }) {
  if (viaIntaSend) return intasend.b2cPayment({ phone, amount, remarks, name });
  if (isMock) return { providerReference: `mock-${randomUUID()}` };
  const data = await post('/mpesa/b2c/v3/paymentrequest', {
    OriginatorConversationID: originatorConversationId,
    InitiatorName: cfg.b2cInitiatorName,
    SecurityCredential: cfg.b2cSecurityCredential,
    CommandID: 'BusinessPayment',
    Amount: amount,
    PartyA: cfg.b2cShortcode,
    PartyB: phone,
    Remarks: remarks.slice(0, 100),
    QueueTimeOutURL: callbackUrl('b2c/timeout'),
    ResultURL: callbackUrl('b2c/result'),
    Occasion: occasion,
  });
  return { providerReference: data.ConversationID ?? null };
}

/**
 * Sends money to a bank account through the bank's M-Pesa paybill (account number as the reference).
 * Uses the same shortcode and initiator as B2C. Daraja picks its own OriginatorConversationID for B2B,
 * so it is returned for the caller to store and match the result callback.
 */
export async function b2bPayment({ originatorConversationId, paybill, accountReference, amount, remarks, name }) {
  if (viaIntaSend) return intasend.b2bPayment({ paybill, accountReference, amount, remarks, name });
  if (isMock) return { providerReference: `mock-${randomUUID()}`, originatorConversationId };
  const data = await post('/mpesa/b2b/v1/paymentrequest', {
    Initiator: cfg.b2cInitiatorName,
    SecurityCredential: cfg.b2cSecurityCredential,
    CommandID: 'BusinessPayBill',
    SenderIdentifierType: '4',
    RecieverIdentifierType: '4',
    Amount: amount,
    PartyA: cfg.b2cShortcode,
    PartyB: paybill,
    AccountReference: accountReference.slice(0, 13),
    Remarks: remarks.slice(0, 100),
    QueueTimeOutURL: callbackUrl('b2b/timeout'),
    ResultURL: callbackUrl('b2b/result'),
  });
  return { providerReference: data.ConversationID ?? null, originatorConversationId: data.OriginatorConversationID ?? originatorConversationId };
}

/** Outcome of a payout as a B2C result, or null if unknown yet. Daraja reports by callback, so null. */
export async function b2cStatus(providerReference) {
  if (viaIntaSend) return intasend.b2cStatus(providerReference);
  return null;
}

export const mockStkCallback = ({ checkoutRequestId, amount, phone }) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: 'mock',
      CheckoutRequestID: checkoutRequestId,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: {
        Item: [
          { Name: 'Amount', Value: amount },
          { Name: 'MpesaReceiptNumber', Value: `MOCK${randomUUID().slice(0, 8).toUpperCase()}` },
          { Name: 'PhoneNumber', Value: Number(phone) },
        ],
      },
    },
  },
});

export const mockB2cResult = ({ originatorConversationId }) => ({
  Result: {
    ResultType: 0,
    ResultCode: 0,
    ResultDesc: 'The service request is processed successfully.',
    OriginatorConversationID: originatorConversationId,
    ConversationID: 'mock',
    TransactionID: `MOCK${randomUUID().slice(0, 8).toUpperCase()}`,
  },
});
