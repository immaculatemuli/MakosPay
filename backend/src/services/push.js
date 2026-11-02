// Push notifications through Expo's push service: each in-app notification is also sent to the user's phones,
// so it arrives while the app is closed. Only notifications that were saved are pushed (a timer picks them up),
// each once (pushed_at). Phones that no longer accept pushes are forgotten.
import { config } from '../config.js';
import { db, NOW } from '../database.js';
import { HttpError } from '../errors.js';

const cfg = config.push;
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/;
// Older than this and not pushed yet: too late to be useful, so it is only marked as handled.
const FRESH_MS = 10 * 60_000;

/** This phone receives this user's notifications (a phone belongs to whoever signed in on it last). */
export async function registerPushToken(userId, token) {
  if (!TOKEN.test(token)) throw new HttpError(400, 'BAD_PUSH_TOKEN', 'Not an Expo push token');
  const existing = await db.get('SELECT id FROM push_tokens WHERE token = ?', token);
  if (existing) await db.run(`UPDATE push_tokens SET user_id = ?, last_seen_at = ${NOW} WHERE id = ?`, userId, existing.id);
  else await db.insert('INSERT INTO push_tokens (user_id, token) VALUES (?, ?)', userId, token);
}

/** Signed out on this phone: stop sending it this user's notifications. */
export const removePushToken = (userId, token) => db.run('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', userId, token);

let flushing = false;

/** Pushes every saved notification not pushed yet (to users with a phone registered). */
export async function flushPush() {
  if (flushing || !cfg.enabled) return;
  flushing = true;
  try {
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const rows = await db.all(
      `SELECT n.id, n.title, n.body, n.target, n.kind, t.token
       FROM notifications n JOIN push_tokens t ON t.user_id = n.user_id
       WHERE n.pushed_at IS NULL AND n.created_at >= ? ORDER BY n.id LIMIT 300`,
      since,
    );
    const ids = [...new Set(rows.map((r) => r.id))];
    if (rows.length) {
      const messages = rows.map((r) => ({ to: r.token, title: r.title, body: r.body ?? undefined, sound: 'default', data: { notification_id: r.id, target: r.target, kind: r.kind } }));
      for (let i = 0; i < messages.length; i += 100) await send(messages.slice(i, i + 100));
    }
    // Pushed, or nobody to push to, or too old: never looked at again.
    if (ids.length) await db.run(`UPDATE notifications SET pushed_at = ${NOW} WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids);
    await db.run(`UPDATE notifications SET pushed_at = ${NOW} WHERE pushed_at IS NULL AND (created_at < ? OR user_id NOT IN (SELECT user_id FROM push_tokens))`, since);
  } finally {
    flushing = false;
  }
}

async function send(messages) {
  let data;
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cfg.accessToken && { Authorization: `Bearer ${cfg.accessToken}` }) },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error('[push] could not reach Expo:', err.message);
    return; // the in-app notification is still there; a push is a convenience
  }
  // One ticket per message, in order. A phone that uninstalled the app (or turned it off) is forgotten.
  const tickets = data?.data ?? [];
  for (const [i, ticket] of tickets.entries()) {
    if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      await db.run('DELETE FROM push_tokens WHERE token = ?', messages[i].to);
    }
  }
}
