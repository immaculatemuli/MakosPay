// In-app notifications: a short message for one person, shown under the bell in the app.
// `target` says what the message is about, so the app can open the right screen:
//   wallet | trips | reports | fare-changes | payouts | payout:<id> | money-check | withdrawals
// Notifications are never required for money to move: they only tell people what already happened.
import { db, NOW } from '../database.js';
import { flushPush } from './push.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-15" -> "15 Oct 2026" */
export function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const kesText = (n) => `KES ${n.toLocaleString('en-KE')}`;

/** Sends one notification to each user (duplicates removed). It is also pushed to their phones once saved. */
export async function notify(userIds, { kind, title, body = null, target = null }) {
  for (const userId of new Set(userIds)) {
    await db.run('INSERT INTO notifications (user_id, kind, title, body, target) VALUES (?, ?, ?, ?, ?)', userId, kind, title, body, target);
  }
  kickPush();
}

// Push soon after (the notification has normally been saved by then; the timer catches anything later).
let pushTimer = null;
function kickPush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    flushPush().catch((err) => console.error('[push]', err.message));
  }, 500);
  pushTimer.unref?.();
}

/** Everyone who works in the SACCO office (and platform admins), so nothing waits on one person. */
export async function notifyOffice(message) {
  const office = await db.all("SELECT id FROM users WHERE role IN ('admin', 'platform_admin') AND is_active = TRUE");
  await notify(
    office.map((u) => u.id),
    message,
  );
}

export async function listNotifications(userId, { before, limit }) {
  const items = await db.all(
    'SELECT id, kind, title, body, target, read_at, created_at FROM notifications WHERE user_id = ? AND (CAST(? AS INTEGER) IS NULL OR id < ?) ORDER BY id DESC LIMIT ?',
    userId,
    before ?? null,
    before ?? null,
    limit,
  );
  return { items, next_before: items.length === limit ? items.at(-1).id : null, unread: await unreadCount(userId) };
}

export const unreadCount = async (userId) => (await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)).n;

/** Marks one notification (or, without an id, all of them) as read. */
export async function markRead(userId, notificationId = null) {
  await db.run(
    `UPDATE notifications SET read_at = ${NOW} WHERE user_id = ? AND read_at IS NULL AND (CAST(? AS INTEGER) IS NULL OR id = ?)`,
    userId,
    notificationId,
    notificationId,
  );
  return { unread: await unreadCount(userId) };
}
