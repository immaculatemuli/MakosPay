// IntaSend client (https://intasend.com): a licensed provider that sends the M-Pesa PIN prompt,
// collects into your IntaSend wallet, and sends money from that wallet to M-Pesa numbers.
// Results are translated into the same shapes as Safaricom's Daraja API, so the rest of the
// app (top-ups, fares, payouts) works the same with either provider.
import { config } from '../config.js';

const cfg = config.intasend;
const BASE_URLS = { sandbox: 'https://sandbox.intasend.com', live: 'https://payment.intasend.com' };
const baseUrl = cfg.baseUrlOverride ?? BASE_URLS[cfg.mode];

export const isConfigured = Boolean(cfg.secretKey && cfg.publishableKey);

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        INTASEND_PUBLIC_API_KEY: cfg.publishableKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...body, public_key: cfg.publishableKey }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`IntaSend unreachable: ${err.message}`); // outcome unknown: not marked rejected
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.errors?.map((e) => e.detail).join('; ') || data.detail || `HTTP ${res.status}`;
    const err = new Error(`IntaSend: ${detail}`);
    // A 4xx means IntaSend refused the request, so no money moved.
    err.rejected = res.status >= 400 && res.status < 500;
    throw err;
  }
  return data;
}

/** Sends the "enter your M-Pesa PIN" prompt. The invoice id plays the role of Daraja's CheckoutRequestID. */
export async function stkPush({ phone, amount, accountReference }) {
  const data = await post('/api/v1/payment/mpesa-stk-push/', {
    amount,
    phone_number: phone,
    api_ref: accountReference,
    method: 'M-PESA',
    currency: 'KES',
  });
  const invoiceId = data.invoice?.invoice_id;
  if (!invoiceId) throw Object.assign(new Error('IntaSend did not return an invoice id'), { rejected: true });
  return { CheckoutRequestID: invoiceId, MerchantRequestID: data.id ?? null, ResponseCode: '0' };
}

const FINAL_FAILED = new Set(['FAILED', 'CANCELED', 'CANCELLED']);

/** Outcome of an STK payment. Throws while it is still pending, like Daraja's query does. */
export async function stkQuery(invoiceId) {
  const data = await post('/api/v1/payment/status/', { invoice_id: invoiceId });
  const invoice = data.invoice ?? data;
  const state = String(invoice.state ?? '').toUpperCase();
  if (state === 'COMPLETE') {
    return { ResultCode: 0, ResultDesc: 'Payment completed', MpesaReceiptNumber: invoice.mpesa_reference || null };
  }
  if (FINAL_FAILED.has(state)) {
    return { ResultCode: invoice.failed_code || 1, ResultDesc: invoice.failed_reason || `Payment ${state.toLowerCase()}` };
  }
  throw new Error(`Payment still ${state.toLowerCase() || 'pending'}`);
}

/** Sends money from the IntaSend wallet to an M-Pesa number. No approval step (requires_approval: NO). */
export async function b2cPayment({ phone, amount, remarks, name }) {
  const data = await post('/api/v1/send-money/initiate/', {
    provider: 'MPESA-B2C',
    currency: 'KES',
    requires_approval: 'NO',
    transactions: [{ name: name || 'FarePay owner', account: phone, amount, narrative: remarks.slice(0, 100) }],
  });
  if (!data.tracking_id) throw Object.assign(new Error('IntaSend did not return a tracking id'), { rejected: true });
  return { providerReference: data.tracking_id };
}

/** Sends money from the IntaSend wallet to a bank's M-Pesa paybill, with the bank account number as reference. */
export async function b2bPayment({ paybill, accountReference, amount, remarks, name }) {
  const data = await post('/api/v1/send-money/initiate/', {
    provider: 'MPESA-B2B',
    currency: 'KES',
    requires_approval: 'NO',
    transactions: [
      { name: name || 'FarePay owner', account: paybill, account_type: 'PayBill', account_reference: accountReference, amount, narrative: remarks.slice(0, 100) },
    ],
  });
  if (!data.tracking_id) throw Object.assign(new Error('IntaSend did not return a tracking id'), { rejected: true });
  return { providerReference: data.tracking_id };
}

const FAILED_STATUS = /fail|cancel|revers|reject|declin/i;

/**
 * Outcome of a payout as a Daraja-style B2C result, or null while it is still in progress.
 * Transaction code TS100 = successful; codes starting TF = failed.
 */
export async function b2cStatus(trackingId) {
  const data = await post('/api/v1/send-money/status/', { tracking_id: trackingId });
  const txn = data.transactions?.[0];
  if (!txn) return null;
  const code = String(txn.status_code ?? '');
  const status = String(txn.status ?? '');
  if (code === 'TS100' || /^success/i.test(status)) {
    return {
      ResultCode: 0,
      ResultDesc: 'Paid by IntaSend',
      TransactionID: txn.transaction_reference || txn.provider_reference || txn.request_reference_id || trackingId,
    };
  }
  if (code.startsWith('TF') || FAILED_STATUS.test(status)) {
    return { ResultCode: 1, ResultDesc: `IntaSend: ${[status, txn.provider_message || txn.failed_reason].filter(Boolean).join(' - ')}` };
  }
  return null;
}
