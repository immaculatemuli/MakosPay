import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';
import { config } from './config.js';
import { isConfigured, isMock, providerLabel } from './services/mpesa.js';
import { reconcilePendingPayments } from './services/payments.js';
import { reconcileProcessingPayouts, startDailyPayouts } from './services/payouts.js';
import { startNightlyBackup } from './services/backup.js';
import { startCashReminders } from './services/cash.js';
import { startNightlyMoneyCheck } from './services/reconciliation.js';
import { nextSeatTimerAt, runSeatTimers, startNightlySeatRefunds } from './services/seats.js';
import { nextWithdrawalRetryAt, reconcileProcessingWithdrawals, retryUnsentWithdrawals } from './services/withdrawals.js';
import { applyDueFareChanges } from './services/routes.js';
import { flushPush } from './services/push.js';
import { flushSms } from './services/sms.js';
import { shouldRun } from './services/quiet.js';
import { syncTrackers, trackerOn } from './services/tracker.js';

/**
 * Runs fn on a timer in the background, never two runs at once. It runs while FarePay is in use; when nobody has
 * used it for a while it waits (so the database can sleep), except when `nextAt` (asked after each run) says that
 * something is due at a known time.
 */
function every(ms, label, fn, { nextAt = null } = {}) {
  let running = false;
  let dueAt = null;
  setInterval(async () => {
    if (running || !shouldRun(dueAt)) return;
    running = true;
    try {
      await fn();
      if (nextAt) dueAt = await nextAt();
    } catch (err) {
      console.error(`[${label}] failed:`, err.message);
    } finally {
      running = false;
    }
  }, ms);
}

// No host given: Node listens on every address, IPv6 and IPv4. (Only 0.0.0.0 left out IPv6 "localhost" (::1),
// which the Cloudflare tunnel sometimes uses, so some scans got "502 Bad Gateway".)
createApp().listen(config.port, () => {
  console.log(`FarePay API listening on port ${config.port} (M-Pesa: ${providerLabel})`);
  // Phones on the same Wi-Fi reach the API through one of these addresses.
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  http://${net.address}:${config.port}`);
    }
  }
  if (!isConfigured.stk) {
    const keys = config.paymentProvider === 'intasend' ? 'INTASEND_PUBLISHABLE_KEY and INTASEND_SECRET_KEY' : 'MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET';
    console.warn(`! M-Pesa payments are off: set ${keys} in .env`);
  } else if (!isMock) {
    // Keeps confirming pending M-Pesa payments, so a passenger who closes the app is still credited.
    every(config.mpesa.reconcileEveryMs, 'mpesa', () => reconcilePendingPayments());
  }
  if (isConfigured.b2c) {
    if (!isMock) every(config.mpesa.reconcileEveryMs, 'payouts', () => reconcileProcessingPayouts());
    if (!isMock) every(config.mpesa.reconcileEveryMs, 'withdrawals', () => reconcileProcessingWithdrawals());
    // Refunds and withdrawals that could not reach M-Pesa (nothing sent) are tried again.
    if (!isMock) every(60_000, 'withdrawal retries', () => retryUnsentWithdrawals(), { nextAt: nextWithdrawalRetryAt });
    console.log(`  Owners are paid automatically every day at ${config.payoutDailyAt} (Kenyan time)`);
  } else {
    console.warn('! Automatic owner payouts are off: the office sends the money itself and records the M-Pesa code');
  }
  // Owners are owed money either way: the daily run creates the payouts (automatic or for the office to send).
  startDailyPayouts();
  // Every night the books are checked; the office is alerted only if something doesn't add up.
  startNightlyMoneyCheck();
  startNightlySeatRefunds();
  // Crew who haven't entered the day's cash are reminded in the evening.
  startCashReminders();
  console.log(`  Money check runs every night at ${config.moneyCheckDailyAt} (Kenyan time)`);
  startNightlyBackup();
  console.log(`  Database backed up every night at ${config.backupDailyAt} into ${config.backupDir}`);
  // Fare changes scheduled for a date take effect on their own (they are also applied before any fare is charged).
  every(60_000, 'fare changes', () => applyDueFareChanges());
  // Seats booked for later: reminders before the time, and joining the queue when it comes.
  every(60_000, 'seat timers', () => runSeatTimers(), { nextAt: nextSeatTimerAt });
  // GPS trackers in the cars: their positions are read from the tracking system every few seconds.
  if (trackerOn) {
    every(config.tracker.pollMs, 'tracker', () => syncTrackers());
    console.log(`  Car trackers: read from ${config.tracker.url} every ${config.tracker.pollMs / 1000} seconds`);
  }
  // Texts and push notifications waiting to go out (also sent straight after they are made).
  every(5_000, 'sms', () => flushSms());
  if (config.push.enabled) every(5_000, 'push', () => flushPush());
  console.log(
    config.sms.provider === 'africastalking'
      ? `  SMS: Africa's Talking (${config.sms.username === 'sandbox' ? 'sandbox: texts appear in its simulator' : 'live'})`
      : config.sms.provider === 'log'
        ? '  SMS: development mode, texts are written here instead of sent'
        : '! SMS is off: password reset by SMS and parcel texts are not available',
  );
});
