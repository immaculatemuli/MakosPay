const env = process.env;

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: num(env.PORT, 4000),
  jwtSecret: env.JWT_SECRET ?? 'dev-only-insecure-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '30d',
  dbPath: env.DB_PATH ?? './data/farepay.db',

  // The SACCO this FarePay runs for (one SACCO for now), shown to passengers.
  saccoName: env.SACCO_NAME || 'Your SACCO',

  // Text inside each vehicle's QR sticker, followed by the vehicle's secret token.
  qrPrefix: env.QR_PREFIX ?? 'farepay://pay?v=',

  // Wallet limits, in whole shillings.
  minTopup: num(env.MIN_TOPUP, 10),
  maxTopup: num(env.MAX_TOPUP, 20000),
  maxWalletBalance: num(env.MAX_WALLET_BALANCE, 50000),

  // Kenyan time (HH:MM) when every owner is sent their unpaid fares.
  payoutDailyAt: env.PAYOUT_DAILY_AT ?? '21:00',

  // Who moves the M-Pesa money: 'daraja' (Safaricom directly, needs your own Paybill/Till)
  // or 'intasend' (IntaSend's licensed account collects and pays out for you).
  paymentProvider: env.PAYMENT_PROVIDER ?? 'daraja',

  intasend: {
    mode: env.INTASEND_MODE ?? 'sandbox', // sandbox (test money) | live (real money)
    publishableKey: env.INTASEND_PUBLISHABLE_KEY ?? '',
    secretKey: env.INTASEND_SECRET_KEY ?? '',
    baseUrlOverride: env.INTASEND_BASE_URL || null, // tests point this at a fake IntaSend server
  },

  mpesa: {
    mode: env.MPESA_MODE ?? 'sandbox', // sandbox | production | mock (tests only: no Safaricom calls)
    baseUrlOverride: env.MPESA_BASE_URL || null, // tests point this at a fake Daraja server
    queryIntervalMs: num(env.MPESA_QUERY_INTERVAL_MS, 5000),
    reconcileEveryMs: num(env.MPESA_RECONCILE_EVERY_MS, 30_000),
    pendingExpiryMs: num(env.MPESA_PENDING_EXPIRY_MS, 15 * 60 * 1000),
    consumerKey: env.MPESA_CONSUMER_KEY ?? '',
    consumerSecret: env.MPESA_CONSUMER_SECRET ?? '',
    shortcode: env.MPESA_SHORTCODE ?? '174379',
    passkey: env.MPESA_PASSKEY ?? '',
    transactionType: env.MPESA_TRANSACTION_TYPE ?? 'CustomerPayBillOnline',
    partyB: env.MPESA_PARTY_B || env.MPESA_SHORTCODE || '174379',
    callbackBaseUrl: env.MPESA_CALLBACK_BASE_URL ?? 'https://example.com',
    callbackSecret: env.MPESA_CALLBACK_SECRET ?? 'dev-callback-secret',
    b2cShortcode: env.MPESA_B2C_SHORTCODE ?? '',
    b2cInitiatorName: env.MPESA_B2C_INITIATOR_NAME ?? '',
    b2cSecurityCredential: env.MPESA_B2C_SECURITY_CREDENTIAL ?? '',
  },
};

/** True only when real money moves (Safaricom production or IntaSend live); otherwise it is test money. */
export const isRealMoney = () => (config.paymentProvider === 'intasend' ? config.intasend.mode === 'live' : config.mpesa.mode === 'production');

if (config.env === 'production') {
  if (config.jwtSecret === 'dev-only-insecure-secret') throw new Error('JWT_SECRET must be set in production');
  if (config.mpesa.callbackSecret === 'dev-callback-secret') throw new Error('MPESA_CALLBACK_SECRET must be set in production');
  if (config.mpesa.mode === 'mock') throw new Error('MPESA_MODE=mock is for tests only');
}
if (!['sandbox', 'production', 'mock'].includes(config.mpesa.mode)) throw new Error('MPESA_MODE must be sandbox, production or mock');
if (!['daraja', 'intasend'].includes(config.paymentProvider)) throw new Error('PAYMENT_PROVIDER must be daraja or intasend');
if (!['sandbox', 'live'].includes(config.intasend.mode)) throw new Error('INTASEND_MODE must be sandbox or live');
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.payoutDailyAt)) throw new Error('PAYOUT_DAILY_AT must be HH:MM, e.g. 21:00');
