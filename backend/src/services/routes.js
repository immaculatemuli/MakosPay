// Routes and their drop-off stops (each stop has its own cash fare and app fare).
import { z } from 'zod';
import { db, insertId, tx } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { id, kes, name } from '../validate.js';

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
function saveStops(routeId, stops) {
  const keep = new Set();
  stops.forEach((stop, index) => {
    const position = index + 1;
    if (stop.id) {
      const result = db
        .prepare('UPDATE route_stops SET name = ?, cash_fare = ?, app_fare = ?, position = ?, is_active = 1 WHERE id = ? AND route_id = ?')
        .run(stop.name, stop.cash_fare, stop.app_fare, position, stop.id, routeId);
      if (result.changes === 0) throw notFound('Stop');
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

export function createRoute({ name: routeName, origin, stops }) {
  return tx(() => {
    const routeId = insertId(db.prepare('INSERT INTO routes (name, origin) VALUES (?, ?)').run(routeName, origin));
    saveStops(routeId, stops);
    return routeId;
  });
}

export function updateRoute(routeId, { name: routeName, origin, is_active, stops }) {
  tx(() => {
    const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
    if (!route) throw notFound('Route');
    db.prepare('UPDATE routes SET name = ?, origin = ?, is_active = ? WHERE id = ?').run(
      routeName ?? route.name,
      origin ?? route.origin,
      is_active === undefined ? route.is_active : Number(is_active),
      routeId,
    );
    if (stops) saveStops(routeId, stops);
  });
}

export function requireActiveStop(routeId, stopId) {
  const stop = getStop(stopId);
  if (!stop || stop.route_id !== routeId || !stop.is_active) {
    throw new HttpError(400, 'WRONG_STOP', "That drop-off is not on this vehicle's route. Please choose your drop-off again.");
  }
  return stop;
}
