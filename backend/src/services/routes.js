// Routes and their drop-off stops. Each stop has ONE fare: what every passenger pays. (The database keeps two
// columns from an earlier design, cash_fare and app_fare; both now hold the fare, and app_fare is what is charged.)
import { z } from 'zod';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiDayRange, nairobiToday } from '../util.js';
import { id, kes, name } from '../validate.js';
import { kesText, notify, prettyDate } from './notifications.js';

// Removed stops are only kept for past trips, so routes always list their current stops.
const stopsOf = (routeId) =>
  db.all(
    `SELECT id, name, app_fare AS fare, cash_fare, app_fare, cash_fare - app_fare AS you_save, position
     FROM route_stops WHERE route_id = ? AND is_active = TRUE ORDER BY position, id`,
    routeId,
  );

/** One route with its current stops, or null. */
export async function getRoute(routeId) {
  const route = await db.get('SELECT * FROM routes WHERE id = ?', routeId);
  return route ? { ...route, stops: await stopsOf(route.id) } : null;
}

/** All routes, or with `activeOnly` just those in use that have stops (what passengers can choose). */
export async function listRoutes({ activeOnly = false } = {}) {
  await applyDueFareChanges(); // show today's fares, including changes that start today
  const routes = await db.all(`SELECT * FROM routes ${activeOnly ? 'WHERE is_active = TRUE' : ''} ORDER BY is_active DESC, name`);
  const withStops = [];
  for (const r of routes) withStops.push({ ...r, stops: await stopsOf(r.id) });
  return withStops.filter((r) => !activeOnly || r.stops.length > 0);
}

export const getStop = (stopId) => db.get('SELECT * FROM route_stops WHERE id = ?', stopId);

/** { fare } sets both stored columns to the one fare. Apps installed before this still send { cash_fare, app_fare }. */
export const withOneFare = (value) =>
  value && typeof value === 'object' && 'fare' in value ? { ...value, cash_fare: value.fare, app_fare: value.fare } : value;

export const stopSchema = z.preprocess(
  withOneFare,
  z
    .object({ id: id.optional(), name, cash_fare: kes, app_fare: kes })
    .refine((s) => s.app_fare <= s.cash_fare, { path: ['app_fare'], message: 'App fare cannot be more than the cash fare' }),
);

export const stopsSchema = z
  .array(stopSchema)
  .min(1, 'Add at least one drop-off stop')
  .max(50)
  .refine((stops) => new Set(stops.map((s) => s.name.toLowerCase())).size === stops.length, 'Each stop needs a different name');

/**
 * Saves the full list of stops for a route, in order. Stops with an id are updated, new ones added,
 * and stops left out are switched off (kept for past trips). Must run inside tx().
 */
async function saveStops(routeId, stops, changedBy) {
  const keep = new Set();
  for (const [index, stop] of stops.entries()) {
    const position = index + 1;
    if (stop.id) {
      const before = await db.get('SELECT cash_fare, app_fare FROM route_stops WHERE id = ? AND route_id = ?', stop.id, routeId);
      if (!before) throw notFound('Stop');
      await db.run(
        'UPDATE route_stops SET name = ?, cash_fare = ?, app_fare = ?, position = ?, is_active = TRUE WHERE id = ?',
        stop.name,
        stop.cash_fare,
        stop.app_fare,
        position,
        stop.id,
      );
      // An edit to the fares takes effect now; record it in the fare history.
      if (before.cash_fare !== stop.cash_fare || before.app_fare !== stop.app_fare) {
        await db.run(
          `INSERT INTO fare_changes (stop_id, old_cash_fare, old_app_fare, new_cash_fare, new_app_fare, effective_from, applied_at, changed_by)
           VALUES (?, ?, ?, ?, ?, ${NOW}, ${NOW}, ?)`,
          stop.id,
          before.cash_fare,
          before.app_fare,
          stop.cash_fare,
          stop.app_fare,
          changedBy,
        );
      }
      keep.add(stop.id);
    } else {
      keep.add(
        await db.insert(
          'INSERT INTO route_stops (route_id, name, cash_fare, app_fare, position) VALUES (?, ?, ?, ?, ?)',
          routeId,
          stop.name,
          stop.cash_fare,
          stop.app_fare,
          position,
        ),
      );
    }
  }
  for (const { id: stopId } of await db.all('SELECT id FROM route_stops WHERE route_id = ? AND is_active = TRUE', routeId)) {
    if (!keep.has(stopId)) await db.run('UPDATE route_stops SET is_active = FALSE WHERE id = ?', stopId);
  }
}

export function createRoute({ name: routeName, origin, stops }, changedBy) {
  return tx(async () => {
    const routeId = await db.insert('INSERT INTO routes (name, origin) VALUES (?, ?)', routeName, origin);
    await saveStops(routeId, stops, changedBy);
    return routeId;
  });
}

export async function updateRoute(routeId, { name: routeName, origin, is_active, stops }, changedBy) {
  await tx(async () => {
    const route = await db.get('SELECT * FROM routes WHERE id = ?', routeId);
    if (!route) throw notFound('Route');
    await db.run(
      'UPDATE routes SET name = ?, origin = ?, is_active = ? WHERE id = ?',
      routeName ?? route.name,
      origin ?? route.origin,
      is_active === undefined ? Boolean(route.is_active) : is_active,
      routeId,
    );
    if (stops) await saveStops(routeId, stops, changedBy);
  });
}

// ---------- Scheduled fare changes ----------

const FARE_CHANGE_SELECT = `
  SELECT f.*, s.name AS stop_name, s.route_id, r.name AS route_name, u.name AS changed_by_name
  FROM fare_changes f
  JOIN route_stops s ON s.id = f.stop_id
  JOIN routes r ON r.id = s.route_id
  JOIN users u ON u.id = f.changed_by`;

export const getFareChange = (id) => db.get(`${FARE_CHANGE_SELECT} WHERE f.id = ?`, id);

/** Fare history for one route: applied, waiting and cancelled changes, newest first. */
export const routeFareChanges = (routeId) => db.all(`${FARE_CHANGE_SELECT} WHERE s.route_id = ? ORDER BY f.id DESC LIMIT 200`, routeId);

/**
 * Applies every waiting fare change whose date has come. Called on a timer and before any fare is quoted
 * or charged, so passengers never pay an out-of-date fare. The "old" fares are taken at the moment it applies.
 */
export async function applyDueFareChanges(now = new Date().toISOString()) {
  const due = await db.all('SELECT * FROM fare_changes WHERE applied_at IS NULL AND cancelled_at IS NULL AND effective_from <= ? ORDER BY effective_from, id', now);
  if (due.length === 0) return 0;
  await tx(async () => {
    for (const change of due) {
      // Applied meanwhile (e.g. by another request at the same moment): nothing to do.
      const still = await db.get('SELECT 1 FROM fare_changes WHERE id = ? AND applied_at IS NULL AND cancelled_at IS NULL', change.id);
      if (!still) continue;
      const stop = await db.get('SELECT cash_fare, app_fare FROM route_stops WHERE id = ?', change.stop_id);
      await db.run('UPDATE route_stops SET cash_fare = ?, app_fare = ? WHERE id = ?', change.new_cash_fare, change.new_app_fare, change.stop_id);
      await db.run(`UPDATE fare_changes SET old_cash_fare = ?, old_app_fare = ?, applied_at = ${NOW} WHERE id = ?`, stop.cash_fare, stop.app_fare, change.id);
    }
  });
  return due.length;
}

/**
 * Sets a new fare for one stop from a date (YYYY-MM-DD, Kenyan time: from midnight that day). Today or an
 * earlier date applies at once. A newer scheduled change replaces any that was still waiting for that stop.
 */
export async function scheduleFareChange(stopId, { cash_fare, app_fare, effective_date, reason }, changedBy) {
  const stop = await getStop(stopId);
  if (!stop || !stop.is_active) throw notFound('Stop');
  const effectiveFrom = nairobiDayRange(effective_date)[0];
  const id = await tx(async () => {
    await db.run(`UPDATE fare_changes SET cancelled_at = ${NOW} WHERE stop_id = ? AND applied_at IS NULL AND cancelled_at IS NULL`, stopId);
    return db.insert(
      `INSERT INTO fare_changes (stop_id, old_cash_fare, old_app_fare, new_cash_fare, new_app_fare, effective_from, reason, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      stopId,
      stop.cash_fare,
      stop.app_fare,
      cash_fare,
      app_fare,
      effectiveFrom,
      reason ?? null,
      changedBy,
    );
  });
  await applyDueFareChanges();
  await notifyFareChange(stop, { cash_fare, app_fare, effective_date });
  return getFareChange(id);
}

/** Tells passengers who use this route (saved one of its stops, or paid on it in the last 60 days) about a new fare. */
async function notifyFareChange(stop, { cash_fare, app_fare, effective_date }) {
  if (cash_fare === stop.cash_fare && app_fare === stop.app_fare) return;
  const route = await db.get('SELECT name, is_active FROM routes WHERE id = ?', stop.route_id);
  if (!route?.is_active) return;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const passengers = (
    await db.all(
      `SELECT u.id FROM users u
       WHERE u.role = 'passenger' AND u.is_active = TRUE AND u.id IN (
         SELECT ss.user_id FROM saved_stops ss JOIN route_stops s ON s.id = ss.stop_id WHERE s.route_id = ?
         UNION SELECT t.passenger_id FROM trips t WHERE t.route_id = ? AND t.created_at >= ?)`,
      stop.route_id,
      stop.route_id,
      since,
    )
  ).map((u) => u.id);
  const when = effective_date <= nairobiToday() ? 'from today' : `from ${prettyDate(effective_date)}`;
  await notify(passengers, {
    kind: 'fare.changed',
    title: `New fare to ${stop.name} (${route.name})`,
    body: `Fare ${kesText(stop.app_fare)} → ${kesText(app_fare)}, ${when}.`,
    target: 'fare-changes',
  });
}

/** Cancels a fare change that hasn't taken effect yet. */
export async function cancelFareChange(changeId) {
  const change = await db.get('SELECT * FROM fare_changes WHERE id = ?', changeId);
  if (!change) throw notFound('Fare change');
  if (change.applied_at) throw new HttpError(409, 'ALREADY_APPLIED', 'This fare change has already taken effect. Set a new fare instead.');
  await db.run(`UPDATE fare_changes SET cancelled_at = ${NOW} WHERE id = ? AND cancelled_at IS NULL`, changeId);
  return getFareChange(changeId);
}

/** For passengers: fare changes on routes in use, recent (last 30 days) and coming up. */
export function publicFareChanges() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return db.all(
    `SELECT f.id, f.old_cash_fare, f.old_app_fare, f.new_cash_fare, f.new_app_fare, f.effective_from, f.applied_at,
            s.name AS stop_name, r.name AS route_name
     FROM fare_changes f JOIN route_stops s ON s.id = f.stop_id JOIN routes r ON r.id = s.route_id
     WHERE f.cancelled_at IS NULL AND s.is_active = TRUE AND r.is_active = TRUE
       AND (f.applied_at IS NULL OR f.applied_at >= ?)
     ORDER BY f.effective_from DESC LIMIT 50`,
    since,
  );
}

export async function requireActiveStop(routeId, stopId) {
  const stop = await getStop(stopId);
  if (!stop || stop.route_id !== routeId || !stop.is_active) {
    throw new HttpError(400, 'WRONG_STOP', "That drop-off is not on this vehicle's route. Please choose your drop-off again.");
  }
  return stop;
}
