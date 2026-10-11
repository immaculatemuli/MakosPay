// In-app notifications: a short message for one person, shown under the bell in the app.
// `target` says what the message is about, so the app can open the right screen:
//   wallet | trips | reports | fare-changes | payouts | payout:<id> | money-check
// Notifications are never required for money to move: they only tell people what already happened.
import { db, NOW } from '../db.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-15" -> "15 Oct 2026" */
export function prettyDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const kesText = (n) => `KES ${n.toLocaleString('en-KE')}`;

/** Sends one notification to each user (duplicates removed). */
export function notify(userIds, { kind, title, body = null, target = null }) {
  const insert = db.prepare('INSERT INTO notifications (user_id, kind, title, body, target) VALUES (?, ?, ?, ?, ?)');
  for (const userId of new Set(userIds)) insert.run(userId, kind, title, body, target);
}

/** Everyone who works in the SACCO office (and platform admins), so nothing waits on one person. */
export function notifyOffice(message) {
  notify(
    db.prepare("SELECT id FROM users WHERE role IN ('admin', 'platform_admin') AND is_active = 1").all().map((u) => u.id),
    message,
  );
}

export function listNotifications(userId, { before, limit }) {
  const items = db
    .prepare('SELECT id, kind, title, body, target, read_at, created_at FROM notifications WHERE user_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?')
    .all(userId, before ?? null, before ?? null, limit);
  return { items, next_before: items.length === limit ? items.at(-1).id : null, unread: unreadCount(userId) };
}

export const unreadCount = (userId) => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;

/** Marks one notification (or, without an id, all of them) as read. */
export function markRead(userId, notificationId = null) {
  db.prepare(`UPDATE notifications SET read_at = ${NOW} WHERE user_id = ? AND read_at IS NULL AND (? IS NULL OR id = ?)`).run(
    userId,
    notificationId,
    notificationId,
  );
  return { unread: unreadCount(userId) };
}
