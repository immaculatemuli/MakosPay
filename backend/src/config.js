import { fileURLToPath } from 'node:url';

const env = process.env;

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: num(env.PORT, 4000),
  jwtSecret: env.JWT_SECRET ?? 'dev-only-insecure-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '30d',
  // How long an office web-dashboard sign-in lasts (the phone app's lasts JWT_EXPIRES_IN).
  webSessionHours: num(env.WEB_SESSION_HOURS, 12),
  // The built office dashboard (admin-web/dist), served at /office/ when it exists.
  officeWebDir: env.OFFICE_WEB_DIR || fileURLToPath(new URL('../../admin-web/dist', import.meta.url)),
  dbPath: env.DB_PATH ?? './data/farepay.db',
  // Which database the app uses: 'sqlite' (DB_PATH, today) or 'postgres' (DATABASE_URL, being prepared).
  dbEngine: env.DB_ENGINE ?? 'sqlite',
  databaseUrl: env.DATABASE_URL || null,
  // Tests only: each test file gets its own empty PostgreSQL schema (needs a database whose name ends in _test).
  dbIsolate: env.DB_ISOLATE === '1',
  dbSchema: env.DB_SCHEMA || null,
  // A copy of the database is saved every night (Kenyan time) into backupDir; the newest backupKeep are kept.
  backupDir: env.BACKUP_DIR ?? './data/backups',
  backupDailyAt: env.BACKUP_DAILY_AT ?? '03:00',
  backupKeep: num(env.BACKUP_KEEP, 14),
  // How many proxies sit in front of the server (e.g. 1 for Caddy), so limits see the phone's real address.
  trustProxy: /^\d+$/.test(env.TRUST_PROXY ?? '') ? Number(env.TRUST_PROXY) : env.TRUST_PROXY || false,

  // The SACCO this FarePay runs for (one SACCO for now), shown to passengers.
  saccoName: env.SACCO_NAME || 'Your SACCO',

  // Text inside each vehicle's QR sticker, followed by the vehicle's secret token. With the server's https
  // address set, the sticker is a link to its pay page, so any phone camera can pay (the app scans it too).
  qrPrefix: env.QR_PREFIX || (/^https:\/\//.test(env.MPESA_CALLBACK_BASE_URL ?? '') ? `${env.MPESA_CALLBACK_BASE_URL.replace(/\/+$/, '')}/pay?v=` : 'farepay://pay?v='),

  // Wallet limits, in whole shillings.
  minTopup: num(env.MIN_TOPUP, 10),
  maxTopup: num(env.MAX_TOPUP, 20000),
  maxWalletBalance: num(env.MAX_WALLET_BALANCE, 50000),
  // Passengers taking wallet money back to their M-Pesa: smallest amount, and how many times a day.
  minWithdrawal: num(env.MIN_WITHDRAWAL, 10),
  maxWithdrawalsPerDay: num(env.MAX_WITHDRAWALS_PER_DAY, 2),

  // Kenyan time (HH:MM) when every owner is sent their unpaid fares.
  payoutDailyAt: env.PAYOUT_DAILY_AT ?? '21:00',
  // Kenyan time (HH:MM) of the nightly money check; the office is alerted if anything doesn't add up.
  moneyCheckDailyAt: env.MONEY_CHECK_DAILY_AT ?? '23:00',

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
  if (config.jwtSecret === 'dev-only-insecure-secret' || config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be set in production (at least 32 random characters)');
  if (config.mpesa.callbackSecret === 'dev-callback-secret' || config.mpesa.callbackSecret.length < 24) {
    throw new Error('MPESA_CALLBACK_SECRET must be set in production (at least 24 random characters)');
  }
  if (config.mpesa.mode === 'mock') throw new Error('MPESA_MODE=mock is for tests only');
  if (config.paymentProvider === 'daraja' && !/^https:\/\//.test(config.mpesa.callbackBaseUrl)) throw new Error('MPESA_CALLBACK_BASE_URL must be an https:// address in production');
  if (config.dbPath === ':memory:') throw new Error('DB_PATH must be a file in production');
}
// Real money only with every production safety check above switched on.
if (isRealMoney() && config.env !== 'production') throw new Error('Real money (MPESA_MODE=production or INTASEND_MODE=live) needs NODE_ENV=production');
if (!['sandbox', 'production', 'mock'].includes(config.mpesa.mode)) throw new Error('MPESA_MODE must be sandbox, production or mock');
if (!['daraja', 'intasend'].includes(config.paymentProvider)) throw new Error('PAYMENT_PROVIDER must be daraja or intasend');
if (!['sandbox', 'live'].includes(config.intasend.mode)) throw new Error('INTASEND_MODE must be sandbox or live');
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.payoutDailyAt)) throw new Error('PAYOUT_DAILY_AT must be HH:MM, e.g. 21:00');
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.moneyCheckDailyAt)) throw new Error('MONEY_CHECK_DAILY_AT must be HH:MM, e.g. 23:00');
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.backupDailyAt)) throw new Error('BACKUP_DAILY_AT must be HH:MM, e.g. 03:00');
if (!['sqlite', 'postgres'].includes(config.dbEngine)) throw new Error('DB_ENGINE must be sqlite or postgres');
if (!(Number.isInteger(config.webSessionHours) && config.webSessionHours >= 1 && config.webSessionHours <= 24)) throw new Error('WEB_SESSION_HOURS must be a whole number from 1 to 24');
if (config.dbEngine === 'postgres' && !config.databaseUrl) throw new Error('DB_ENGINE=postgres needs DATABASE_URL');
