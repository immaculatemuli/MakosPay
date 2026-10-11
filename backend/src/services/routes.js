// Routes and their drop-off stops (each stop has its own cash fare and app fare).
import { z } from 'zod';
import { db, insertId, NOW, tx } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiDayRange, nairobiToday } from '../util.js';
import { id, kes, name } from '../validate.js';
import { kesText, notify, prettyDate } from './notifications.js';

// Removed stops are only kept for past trips, so routes always list their current stops.
const stopsOf = (routeId) =>
  db
    .prepare(
      `SELECT id, name, cash_fare, app_fare, cash_fare - app_fare AS you_save, position
       FROM route_stops WHERE route_id = ? AND is_active = 1 ORDER BY position, id`,
    )
    .all(routeId);

/** One route with its current stops, or null. */
export function getRoute(routeId) {
  const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
  return route ? { ...route, stops: stopsOf(route.id) } : null;
}

/** All routes, or with `activeOnly` just those in use that have stops (what passengers can choose). */
export function listRoutes({ activeOnly = false } = {}) {
  applyDueFareChanges(); // show today's fares, including changes that start today
  const routes = db.prepare(`SELECT * FROM routes ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY is_active DESC, name`).all();
  return routes.map((r) => ({ ...r, stops: stopsOf(r.id) })).filter((r) => !activeOnly || r.stops.length > 0);
}

export const getStop = (stopId) => db.prepare('SELECT * FROM route_stops WHERE id = ?').get(stopId);

export const stopSchema = z
  .object({ id: id.optional(), name, cash_fare: kes, app_fare: kes })
  .refine((s) => s.app_fare <= s.cash_fare, { path: ['app_fare'], message: 'App fare cannot be more than the cash fare' });

export const stopsSchema = z
  .array(stopSchema)
  .min(1, 'Add at least one drop-off stop')
  .max(50)
  .refine((stops) => new Set(stops.map((s) => s.name.toLowerCase())).size === stops.length, 'Each stop needs a different name');

/**
 * Saves the full list of stops for a route, in order. Stops with an id are updated, new ones added,
 * and stops left out are switched off (kept for past trips). Must run inside tx().
 */
function saveStops(routeId, stops, changedBy) {
  const keep = new Set();
  stops.forEach((stop, index) => {
    const position = index + 1;
    if (stop.id) {
      const before = db.prepare('SELECT cash_fare, app_fare FROM route_stops WHERE id = ? AND route_id = ?').get(stop.id, routeId);
      if (!before) throw notFound('Stop');
      db.prepare('UPDATE route_stops SET name = ?, cash_fare = ?, app_fare = ?, position = ?, is_active = 1 WHERE id = ?').run(
        stop.name,
        stop.cash_fare,
        stop.app_fare,
        position,
        stop.id,
      );
      // An edit to the fares takes effect now; record it in the fare history.
      if (before.cash_fare !== stop.cash_fare || before.app_fare !== stop.app_fare) {
        db.prepare(
          `INSERT INTO fare_changes (stop_id, old_cash_fare, old_app_fare, new_cash_fare, new_app_fare, effective_from, applied_at, changed_by)
           VALUES (?, ?, ?, ?, ?, ${NOW}, ${NOW}, ?)`,
        ).run(stop.id, before.cash_fare, before.app_fare, stop.cash_fare, stop.app_fare, changedBy);
      }
      keep.add(stop.id);
    } else {
      keep.add(
        insertId(
          db
            .prepare('INSERT INTO route_stops (route_id, name, cash_fare, app_fare, position) VALUES (?, ?, ?, ?, ?)')
            .run(routeId, stop.name, stop.cash_fare, stop.app_fare, position),
        ),
      );
    }
  });
  for (const { id: stopId } of db.prepare('SELECT id FROM route_stops WHERE route_id = ? AND is_active = 1').all(routeId)) {
    if (!keep.has(stopId)) db.prepare('UPDATE route_stops SET is_active = 0 WHERE id = ?').run(stopId);
  }
}

export function createRoute({ name: routeName, origin, stops }, changedBy) {
  return tx(() => {
    const routeId = insertId(db.prepare('INSERT INTO routes (name, origin) VALUES (?, ?)').run(routeName, origin));
    saveStops(routeId, stops, changedBy);
    return routeId;
  });
}

export function updateRoute(routeId, { name: routeName, origin, is_active, stops }, changedBy) {
  tx(() => {
    const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
    if (!route) throw notFound('Route');
    db.prepare('UPDATE routes SET name = ?, origin = ?, is_active = ? WHERE id = ?').run(
      routeName ?? route.name,
      origin ?? route.origin,
      is_active === undefined ? route.is_active : Number(is_active),
      routeId,
    );
    if (stops) saveStops(routeId, stops, changedBy);
  });
}

// ---------- Scheduled fare changes ----------

const FARE_CHANGE_SELECT = `
  SELECT f.*, s.name AS stop_name, s.route_id, r.name AS route_name, u.name AS changed_by_name
  FROM fare_changes f
  JOIN route_stops s ON s.id = f.stop_id
  JOIN routes r ON r.id = s.route_id
  JOIN users u ON u.id = f.changed_by`;

export const getFareChange = (id) => db.prepare(`${FARE_CHANGE_SELECT} WHERE f.id = ?`).get(id);

/** Fare history for one route: applied, waiting and cancelled changes, newest first. */
export const routeFareChanges = (routeId) => db.prepare(`${FARE_CHANGE_SELECT} WHERE s.route_id = ? ORDER BY f.id DESC LIMIT 200`).all(routeId);

/**
 * Applies every waiting fare change whose date has come. Called on a timer and before any fare is quoted
 * or charged, so passengers never pay an out-of-date fare. The "old" fares are taken at the moment it applies.
 */
export function applyDueFareChanges(now = new Date().toISOString()) {
  const due = db
    .prepare('SELECT * FROM fare_changes WHERE applied_at IS NULL AND cancelled_at IS NULL AND effective_from <= ? ORDER BY effective_from, id')
    .all(now);
  if (due.length === 0) return 0;
  tx(() => {
    for (const change of due) {
      const stop = db.prepare('SELECT cash_fare, app_fare FROM route_stops WHERE id = ?').get(change.stop_id);
      db.prepare('UPDATE route_stops SET cash_fare = ?, app_fare = ? WHERE id = ?').run(change.new_cash_fare, change.new_app_fare, change.stop_id);
      db.prepare(`UPDATE fare_changes SET old_cash_fare = ?, old_app_fare = ?, applied_at = ${NOW} WHERE id = ?`).run(stop.cash_fare, stop.app_fare, change.id);
    }
  });
  return due.length;
}

/**
 * Sets a new fare for one stop from a date (YYYY-MM-DD, Kenyan time: from midnight that day). Today or an
 * earlier date applies at once. A newer scheduled change replaces any that was still waiting for that stop.
 */
export function scheduleFareChange(stopId, { cash_fare, app_fare, effective_date, reason }, changedBy) {
  const stop = getStop(stopId);
  if (!stop || !stop.is_active) throw notFound('Stop');
  const effectiveFrom = nairobiDayRange(effective_date)[0];
  const id = tx(() => {
    db.prepare(`UPDATE fare_changes SET cancelled_at = ${NOW} WHERE stop_id = ? AND applied_at IS NULL AND cancelled_at IS NULL`).run(stopId);
    return insertId(
      db
        .prepare(
          `INSERT INTO fare_changes (stop_id, old_cash_fare, old_app_fare, new_cash_fare, new_app_fare, effective_from, reason, changed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(stopId, stop.cash_fare, stop.app_fare, cash_fare, app_fare, effectiveFrom, reason ?? null, changedBy),
    );
  });
  applyDueFareChanges();
  notifyFareChange(stop, { cash_fare, app_fare, effective_date });
  return getFareChange(id);
}

/** Tells passengers who use this route (saved one of its stops, or paid on it in the last 60 days) about a new fare. */
function notifyFareChange(stop, { cash_fare, app_fare, effective_date }) {
  if (cash_fare === stop.cash_fare && app_fare === stop.app_fare) return;
  const route = db.prepare('SELECT name, is_active FROM routes WHERE id = ?').get(stop.route_id);
  if (!route?.is_active) return;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const passengers = db
    .prepare(
      `SELECT u.id FROM users u
       WHERE u.role = 'passenger' AND u.is_active = 1 AND u.id IN (
         SELECT ss.user_id FROM saved_stops ss JOIN route_stops s ON s.id = ss.stop_id WHERE s.route_id = ?
         UNION SELECT t.passenger_id FROM trips t WHERE t.route_id = ? AND t.created_at >= ?)`,
    )
    .all(stop.route_id, stop.route_id, since)
    .map((u) => u.id);
  const when = effective_date <= nairobiToday() ? 'from today' : `from ${prettyDate(effective_date)}`;
  notify(passengers, {
    kind: 'fare.changed',
    title: `New fare to ${stop.name} (${route.name})`,
    body: `FarePay fare ${kesText(stop.app_fare)} → ${kesText(app_fare)} (cash ${kesText(stop.cash_fare)} → ${kesText(cash_fare)}), ${when}.`,
    target: 'fare-changes',
  });
}

/** Cancels a fare change that hasn't taken effect yet. */
export function cancelFareChange(changeId) {
  const change = db.prepare('SELECT * FROM fare_changes WHERE id = ?').get(changeId);
  if (!change) throw notFound('Fare change');
  if (change.applied_at) throw new HttpError(409, 'ALREADY_APPLIED', 'This fare change has already taken effect. Set a new fare instead.');
  db.prepare(`UPDATE fare_changes SET cancelled_at = ${NOW} WHERE id = ? AND cancelled_at IS NULL`).run(changeId);
  return getFareChange(changeId);
}

/** For passengers: fare changes on routes in use, recent (last 30 days) and coming up. */
export function publicFareChanges() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return db
    .prepare(
      `SELECT f.id, f.old_cash_fare, f.old_app_fare, f.new_cash_fare, f.new_app_fare, f.effective_from, f.applied_at,
              s.name AS stop_name, r.name AS route_name
       FROM fare_changes f JOIN route_stops s ON s.id = f.stop_id JOIN routes r ON r.id = s.route_id
       WHERE f.cancelled_at IS NULL AND s.is_active = 1 AND r.is_active = 1
         AND (f.applied_at IS NULL OR f.applied_at >= ?)
       ORDER BY f.effective_from DESC LIMIT 50`,
    )
    .all(since);
}

export function requireActiveStop(routeId, stopId) {
  const stop = getStop(stopId);
  if (!stop || stop.route_id !== routeId || !stop.is_active) {
    throw new HttpError(400, 'WRONG_STOP', "That drop-off is not on this vehicle's route. Please choose your drop-off again.");
  }
  return stop;
}
