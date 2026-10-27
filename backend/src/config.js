import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const env = process.env;

// A secret that goes inside a web address (the M-Pesa and USSD callbacks) may only hold letters, digits, - and _.
// One with other characters (e.g. Render's generated secrets: base64, with + / =) is used as a hex hash of itself.
const urlSafe = (secret) => (/^[A-Za-z0-9_-]+$/.test(secret) ? secret : createHash('sha256').update(secret).digest('hex'));

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
  // The public website (website/), served at the main address: /, /privacy.html ...
  websiteDir: env.WEBSITE_DIR || fileURLToPath(new URL('../../website', import.meta.url)),
  // The file name Google Search Console gives to prove the website is ours (e.g. google1a2b3c4d5e6f.html). Empty: none.
  googleSiteVerification: /^google[0-9a-f]+\.html$/.test(env.GOOGLE_SITE_VERIFICATION ?? '') ? env.GOOGLE_SITE_VERIFICATION : null,
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
  // Background jobs keep running this long after FarePay was last used; then they wait, so the database can sleep.
  quietAfterMs: num(env.QUIET_AFTER_MINUTES, 15) * 60_000,
  // Kenyan time when trips the crew never finished (and cars left loading) are closed for the night.
  closeTripsAt: env.CLOSE_TRIPS_AT ?? '03:00',
  backupKeep: num(env.BACKUP_KEEP, 14),
  // How many proxies sit in front of the server (e.g. 1 for Caddy), so limits see the phone's real address.
  trustProxy: /^\d+$/.test(env.TRUST_PROXY ?? '') ? Number(env.TRUST_PROXY) : env.TRUST_PROXY || false,

  // The SACCO this FarePay runs for (one SACCO for now), shown to passengers.
  saccoName: env.SACCO_NAME || 'Your SACCO',

  // Text inside each vehicle's QR sticker, followed by the vehicle's secret token. With the server's https
  // address set, the sticker is a link to its pay page, so any phone camera can pay (the app scans it too).
  // The SACCO's USSD code (e.g. *384*12345#), printed on stickers for passengers without a smartphone. Empty: not yet.
  ussdCode: env.USSD_CODE || null,
  qrPrefix: env.QR_PREFIX || (/^https:\/\//.test(env.MPESA_CALLBACK_BASE_URL ?? '') ? `${env.MPESA_CALLBACK_BASE_URL.replace(/\/+$/, '')}/pay?v=` : 'farepay://pay?v='),

  // The phone app: the newest version, and the oldest that still works (older ones must update). Empty: no check.
  // Change them after publishing a new APK, e.g. APP_LATEST_VERSION=1.1.0.
  app: {
    latestVersion: env.APP_LATEST_VERSION || null,
    minimumVersion: env.APP_MIN_VERSION || null,
    downloadUrl: env.APP_DOWNLOAD_URL || 'https://github.com/immaculatemuli/MakosPay/releases/latest/download/FarePay.apk',
    // Named in the "please update" message that apps older than the minimum get instead of every answer.
    website: env.APP_WEBSITE || 'farepayimm.netlify.app',
  },

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
  // Seat bookings are for today only: none are taken from SEAT_BOOKING_CUTOFF until SEAT_BOOKING_OPENS (Kenyan
  // time), and any paid booking not yet on a car at the cutoff is refunded.
  seatBookingCutoff: env.SEAT_BOOKING_CUTOFF ?? '22:00',
  // Crew who haven't entered the day's cash by then are reminded (Kenyan time).
  cashReminderAt: env.CASH_REMINDER_AT ?? '20:00',
  seatBookingOpens: env.SEAT_BOOKING_OPENS ?? '04:00',
  // Loyalty: every FREE_RIDE_EVERY-th paid ride is free (0 = off), counting paid rides in the last FREE_RIDE_WINDOW_DAYS.
  freeRideEvery: num(env.FREE_RIDE_EVERY, 50),
  freeRideWindowDays: num(env.FREE_RIDE_WINDOW_DAYS, 90),
  // Text each owner what they were paid, and from which cars, when a payout reaches them (OWNER_PAYOUT_SMS=0 turns it off).
  ownerPayoutSms: env.OWNER_PAYOUT_SMS !== '0',
  // Owners are paid only the fares their car's driver has released ("Send to owner" in the driver's app, never the
  // conductor). PAYOUTS_NEED_DRIVER=false: every fare is paid out by the daily run or the office's "Pay now".
  payoutsNeedDriver: env.PAYOUTS_NEED_DRIVER !== 'false',
  // Seat bookings one passenger can have waiting at once.
  maxOpenSeatBookings: num(env.MAX_OPEN_SEAT_BOOKINGS, 3),

  // Who moves the M-Pesa money: 'daraja' (Safaricom directly, needs your own Paybill/Till)
  // or 'intasend' (IntaSend's licensed account collects and pays out for you).
  paymentProvider: env.PAYMENT_PROVIDER ?? 'daraja',

  intasend: {
    mode: env.INTASEND_MODE ?? 'sandbox', // sandbox (test money) | live (real money)
    publishableKey: env.INTASEND_PUBLISHABLE_KEY ?? '',
    secretKey: env.INTASEND_SECRET_KEY ?? '',
    baseUrlOverride: env.INTASEND_BASE_URL || null, // tests point this at a fake IntaSend server
  },

  // SMS (password reset codes, parcel codes): 'africastalking' (AT_USERNAME 'sandbox' = Africa's Talking's free
  // test system, whose texts appear in its online simulator), 'log' (development only: texts are written to the
  // server's log) or 'off'.
  // USSD through Africa's Talking: its callback address carries this secret (/ussd/<secret>). The M-Pesa prompt is
  // sent this long after the USSD session ends (a phone can't show it while a USSD screen is open).
  ussd: {
    callbackSecret: urlSafe(env.USSD_SECRET ?? 'dev-ussd-secret'),
    promptDelayMs: Number(env.USSD_PROMPT_DELAY_MS ?? 2500),
  },
  // The map of the car coming to pick a passenger: Google's map tiles when a key is set (Map Tiles API), else
  // OpenStreetMap's (fine for trying things out, not for real use).
  maps: {
    googleKey: env.GOOGLE_MAPS_API_KEY || null,
    googleBaseUrl: env.GOOGLE_TILES_BASE_URL || 'https://tile.googleapis.com', // tests point this at a fake Google
  },

  // GPS trackers fitted in the cars, read from the tracking company's system (TRACKER_PROVIDER=traccar) every few
  // seconds. Each tracker is matched to a car by its name or identifier: the car number (e.g. 101) or the plate.
  // Sign-in: TRACKER_TOKEN (an API token from the tracking system), or TRACKER_EMAIL + TRACKER_PASSWORD.
  tracker: {
    provider: env.TRACKER_PROVIDER || 'off',
    url: (env.TRACKER_URL || '').replace(/\/+$/, ''),
    token: env.TRACKER_TOKEN || null,
    email: env.TRACKER_EMAIL || null,
    password: env.TRACKER_PASSWORD || null,
    pollMs: num(env.TRACKER_POLL_SECONDS, 20) * 1000,
  },

  sms: {
    provider: env.SMS_PROVIDER || (env.NODE_ENV === 'production' ? 'off' : 'log'),
    username: env.AT_USERNAME || 'sandbox',
    apiKey: env.AT_API_KEY || '',
    senderId: env.AT_SENDER_ID || null, // a registered sender name, e.g. MAKOS (live only)
    baseUrlOverride: env.AT_BASE_URL || null, // tests point this at a fake Africa's Talking
  },

  // Push notifications through Expo's push service (the app's notices also arrive when the app is closed).
  push: {
    enabled: env.PUSH_ENABLED !== '0',
    url: env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send',
    accessToken: env.EXPO_ACCESS_TOKEN || null, // optional: only if "enhanced push security" is on in Expo
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
    callbackSecret: urlSafe(env.MPESA_CALLBACK_SECRET ?? 'dev-callback-secret'),
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
  // 'log' writes password reset codes into the server's log: never on the real server.
  if (config.ussd.callbackSecret === 'dev-ussd-secret' || config.ussd.callbackSecret.length < 24) {
    throw new Error('USSD_SECRET must be set to a long random value in production');
  }
  if (config.sms.provider === 'log') throw new Error('SMS_PROVIDER=log is for development only: use africastalking or off');
  if (config.sms.provider === 'africastalking' && !config.sms.apiKey) throw new Error('SMS_PROVIDER=africastalking needs AT_API_KEY');
}
// Real money only with every production safety check above switched on.
if (isRealMoney() && config.env !== 'production') throw new Error('Real money (MPESA_MODE=production or INTASEND_MODE=live) needs NODE_ENV=production');
if (!['sandbox', 'production', 'mock'].includes(config.mpesa.mode)) throw new Error('MPESA_MODE must be sandbox, production or mock');
if (!['daraja', 'intasend'].includes(config.paymentProvider)) throw new Error('PAYMENT_PROVIDER must be daraja or intasend');
if (!['sandbox', 'live'].includes(config.intasend.mode)) throw new Error('INTASEND_MODE must be sandbox or live');
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.payoutDailyAt)) throw new Error('PAYOUT_DAILY_AT must be HH:MM, e.g. 21:00');
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.moneyCheckDailyAt)) throw new Error('MONEY_CHECK_DAILY_AT must be HH:MM, e.g. 23:00');
for (const key of ['seatBookingCutoff', 'seatBookingOpens', 'cashReminderAt']) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config[key])) throw new Error(`${key} must be HH:MM, e.g. 22:00`);
}
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.backupDailyAt)) throw new Error('BACKUP_DAILY_AT must be HH:MM, e.g. 03:00');
if (!['sqlite', 'postgres'].includes(config.dbEngine)) throw new Error('DB_ENGINE must be sqlite or postgres');
if (!['africastalking', 'log', 'off'].includes(config.sms.provider)) throw new Error('SMS_PROVIDER must be africastalking, log or off');
if (!['traccar', 'off'].includes(config.tracker.provider)) throw new Error('TRACKER_PROVIDER must be traccar or off');
if (config.tracker.provider === 'traccar') {
  if (!/^https?:\/\/\S+$/.test(config.tracker.url)) throw new Error('TRACKER_URL must be the tracking system’s address, e.g. https://demo4.traccar.org');
  if (!config.tracker.token && !(config.tracker.email && config.tracker.password)) throw new Error('TRACKER_PROVIDER=traccar needs TRACKER_TOKEN, or TRACKER_EMAIL and TRACKER_PASSWORD');
}
if (!(Number.isInteger(config.webSessionHours) && config.webSessionHours >= 1 && config.webSessionHours <= 24)) throw new Error('WEB_SESSION_HOURS must be a whole number from 1 to 24');
if (config.dbEngine === 'postgres' && !config.databaseUrl) throw new Error('DB_ENGINE=postgres needs DATABASE_URL');
// e.g. 'DATABASE_URL=postgresql://...' pasted as the value, or with quotes: the driver would quietly try this machine instead.
if (config.dbEngine === 'postgres' && !/^postgres(ql)?:\/\/[^/\s]+@[^/\s]+\//.test(config.databaseUrl)) {
  throw new Error('DATABASE_URL must be the address itself, starting with postgresql://user:password@host/ (no quotes, no "DATABASE_URL=" in front)');
}
