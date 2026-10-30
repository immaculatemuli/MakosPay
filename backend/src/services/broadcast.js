// The office sends one message to many crew at once: all drivers (and conductors) on a route, or everyone, or the
// stage marshals. It arrives under their bell and as a push notification; optionally also by SMS.
import { db } from '../database.js';
import { HttpError } from '../errors.js';
import { notify } from './notifications.js';
import { queueSms } from './sms.js';

export const AUDIENCES = ['drivers', 'crew', 'marshals'];

/** Who a message reaches: active drivers (crew = drivers and conductors) of cars on the route (or all), or marshals. */
export function recipients(audience, routeId = null) {
  if (audience === 'marshals') return db.all("SELECT id, phone FROM users WHERE role = 'marshal' AND is_active = TRUE");
  const columns = audience === 'drivers' ? ['driver_id'] : ['driver_id', 'conductor_id'];
  return db.all(
    `SELECT DISTINCT u.id, u.phone FROM users u JOIN vehicles v ON ${columns.map((c) => `v.${c} = u.id`).join(' OR ')}
     WHERE u.is_active = TRUE AND v.is_active = TRUE AND (CAST(? AS INTEGER) IS NULL OR v.route_id = ?)`,
    routeId,
    routeId,
  );
}

export async function sendBroadcast({ audience, routeId = null, message, sms = false }, sender) {
  const people = await recipients(audience, routeId);
  if (people.length === 0) throw new HttpError(409, 'NOBODY', 'Nobody to send this to: no active crew on that route.');
  const route = routeId ? await db.get('SELECT name FROM routes WHERE id = ?', routeId) : null;
  await notify(
    people.map((p) => p.id),
    { kind: 'broadcast', title: `Message from the SACCO office${route ? ` (${route.name})` : ''}`, body: message, target: null },
  );
  if (sms) for (const p of people) await queueSms(p.phone, 'broadcast', `${message} — ${sender.name}, SACCO office`);
  return { sent_to: people.length, by_sms: sms };
}
