// Routes and their drop-off stops. A route has ONE fixed fare: every passenger pays it, wherever they get off
// (Nairobi to Athi River costs the same as Nairobi to Machakos). Each stop row holds a copy of the route's fare,
// so every stop on a route always has the same fare. (The database keeps two columns from an earlier design,
// cash_fare and app_fare; both now hold the fare, and app_fare is what is charged.)
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

/** A route with its current stops, and `fare`: its one fare (the same on every stop). */
async function withStops(route) {
  const stops = await stopsOf(route.id);
  return { ...route, fare: stops.at(-1)?.fare ?? null, stops };
}

/** One route with its current stops, or null. */
export async function getRoute(routeId) {
  const route = await db.get('SELECT * FROM routes WHERE id = ?', routeId);
  return route ? withStops(route) : null;
}

/** All routes, or with `activeOnly` just those in use that have stops (what passengers can choose). */
export async function listRoutes({ activeOnly = false } = {}) {
  await applyDueFareChanges(); // show today's fares, including changes that start today
  const routes = await db.all(`SELECT * FROM routes ${activeOnly ? 'WHERE is_active = TRUE' : ''} ORDER BY is_active DESC, name`);
  const all = [];
  for (const r of routes) all.push(await withStops(r));
  return all.filter((r) => !activeOnly || r.stops.length > 0);
}

export const getStop = (stopId) => db.get('SELECT * FROM route_stops WHERE id = ?', stopId);

/** { fare } sets both stored columns to the one fare. Apps installed before this still send { cash_fare, app_fare }. */
export const withOneFare = (value) =>
  value && typeof value === 'object' && 'fare' in value ? { ...value, cash_fare: value.fare, app_fare: value.fare } : value;

// A stop is just a name. Apps installed before the one route fare still send a fare with each stop:
// then the last stop's fare becomes the route's fare.
export const stopSchema = z.preprocess(
  withOneFare,
  z
    .object({ id: id.optional(), name, cash_fare: kes.optional(), app_fare: kes.optional() })
    .refine((s) => !s.app_fare || s.app_fare <= (s.cash_fare ?? s.app_fare), { path: ['app_fare'], message: 'App fare cannot be more than the cash fare' }),
);

export const stopsSchema = z
  .array(stopSchema)
  .min(1, 'Add at least one drop-off stop')
  .max(50)
  .refine((stops) => new Set(stops.map((s) => s.name.toLowerCase())).size === stops.length, 'Each stop needs a different name');

/** The route's fare ({ cash_fare, app_fare }) from a route body: its `fare`, or else the fare sent with its last stop. */
function routeFareOf({ fare, stops }) {
  if (fare) return { cash_fare: fare, app_fare: fare };
  const last = stops?.at(-1);
  return last?.app_fare ? { cash_fare: last.cash_fare ?? last.app_fare, app_fare: last.app_fare } : null;
}

/** A route's current fare ({ cash_fare, app_fare }), from its last stop. */
const currentFare = (routeId) =>
  db.get('SELECT id, cash_fare, app_fare FROM route_stops WHERE route_id = ? AND is_active = TRUE ORDER BY position DESC, id DESC LIMIT 1', routeId);

/** Puts one fare onto every stop of a route. */
const setRouteFare = (routeId, { cash_fare, app_fare }) =>
  db.run('UPDATE route_stops SET cash_fare = ?, app_fare = ? WHERE route_id = ? AND is_active = TRUE', cash_fare, app_fare, routeId);

/** A fare history entry (kept against the route's last stop) for a fare changed straight away. */
async function recordFareNow(routeId, before, fare, changedBy) {
  const last = await currentFare(routeId);
  await db.run(
    `INSERT INTO fare_changes (stop_id, old_cash_fare, old_app_fare, new_cash_fare, new_app_fare, effective_from, applied_at, changed_by)
     VALUES (?, ?, ?, ?, ?, ${NOW}, ${NOW}, ?)`,
    last.id,
    before.cash_fare,
    before.app_fare,
    fare.cash_fare,
    fare.app_fare,
    changedBy,
  );
}

/**
 * Saves the full list of stops for a route, in order, all at the route's one fare. Stops with an id are updated,
 * new ones added, and stops left out are switched off (kept for past trips). Must run inside tx().
 */
async function saveStops(routeId, stops, fare) {
  const keep = new Set();
  for (const [index, stop] of stops.entries()) {
    const position = index + 1;
    if (stop.id) {
      if (!(await db.get('SELECT 1 FROM route_stops WHERE id = ? AND route_id = ?', stop.id, routeId))) throw notFound('Stop');
      await db.run(
        'UPDATE route_stops SET name = ?, cash_fare = ?, app_fare = ?, position = ?, is_active = TRUE WHERE id = ?',
        stop.name,
        fare.cash_fare,
        fare.app_fare,
        position,
        stop.id,
      );
      keep.add(stop.id);
    } else {
      keep.add(
        await db.insert(
          'INSERT INTO route_stops (route_id, name, cash_fare, app_fare, position) VALUES (?, ?, ?, ?, ?)',
          routeId,
          stop.name,
          fare.cash_fare,
          fare.app_fare,
          position,
        ),
      );
    }
  }
  for (const { id: stopId } of await db.all('SELECT id FROM route_stops WHERE route_id = ? AND is_active = TRUE', routeId)) {
    if (!keep.has(stopId)) await db.run('UPDATE route_stops SET is_active = FALSE WHERE id = ?', stopId);
  }
}

/** { fare } is the route's one fare. */
export function createRoute({ name: routeName, origin, fare, stops }) {
  const routeFare = routeFareOf({ fare, stops });
  if (!routeFare) throw new HttpError(400, 'NO_FARE', 'Enter the fare for this route.');
  return tx(async () => {
    const routeId = await db.insert('INSERT INTO routes (name, origin) VALUES (?, ?)', routeName, origin);
    await saveStops(routeId, stops, routeFare);
    return routeId;
  });
}

/** A new `fare` takes effect now, on every stop, and goes in the fare history. */
export async function updateRoute(routeId, { name: routeName, origin, is_active, fare, stops }, changedBy) {
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
    const before = await currentFare(routeId);
    const after = routeFareOf({ fare, stops }) ?? before;
    if (!after) throw new HttpError(400, 'NO_FARE', 'Enter the fare for this route.');
    if (stops) await saveStops(routeId, stops, after);
    else await setRouteFare(routeId, after);
    if (before && (before.cash_fare !== after.cash_fare || before.app_fare !== after.app_fare)) await recordFareNow(routeId, before, after, changedBy);
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
      // A fare change is for the whole route: every stop on it gets the new fare.
      const stop = await db.get('SELECT route_id, cash_fare, app_fare FROM route_stops WHERE id = ?', change.stop_id);
      await setRouteFare(stop.route_id, { cash_fare: change.new_cash_fare, app_fare: change.new_app_fare });
      await db.run(`UPDATE fare_changes SET old_cash_fare = ?, old_app_fare = ?, applied_at = ${NOW} WHERE id = ?`, stop.cash_fare, stop.app_fare, change.id);
    }
  });
  return due.length;
}

/** Sets a new fare for a route from a date; see scheduleFareChange. */
export async function scheduleRouteFareChange(routeId, change, changedBy) {
  const last = await currentFare(routeId);
  if (!last) throw notFound('Route');
  return scheduleFareChange(last.id, change, changedBy);
}

/**
 * Sets a new fare from a date (YYYY-MM-DD, Kenyan time: from midnight that day) for the whole route of this stop.
 * Today or an earlier date applies at once. A newer scheduled change replaces any still waiting on the route.
 */
export async function scheduleFareChange(stopId, { cash_fare, app_fare, effective_date, reason }, changedBy) {
  const stop = await getStop(stopId);
  if (!stop || !stop.is_active) throw notFound('Stop');
  const effectiveFrom = nairobiDayRange(effective_date)[0];
  const id = await tx(async () => {
    await db.run(
      `UPDATE fare_changes SET cancelled_at = ${NOW}
       WHERE applied_at IS NULL AND cancelled_at IS NULL AND stop_id IN (SELECT id FROM route_stops WHERE route_id = ?)`,
      stop.route_id,
    );
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
    title: `New fare on ${route.name}`,
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

/**
 * Gives every route one fare, for routes saved before fares were per route: all its stops take the fare of
 * its last stop, and only its newest waiting fare change is kept. Run at start-up; once fares agree it changes nothing.
 */
export async function oneFarePerRoute() {
  for (const { route_id: routeId } of await db.all('SELECT DISTINCT route_id FROM route_stops WHERE is_active = TRUE')) {
    await tx(async () => {
      await setRouteFare(routeId, await currentFare(routeId));
      await db.run(
        `UPDATE fare_changes SET cancelled_at = ${NOW}
         WHERE applied_at IS NULL AND cancelled_at IS NULL AND stop_id IN (SELECT id FROM route_stops WHERE route_id = ?)
           AND id < (SELECT MAX(f.id) FROM fare_changes f JOIN route_stops s ON s.id = f.stop_id
                     WHERE s.route_id = ? AND f.applied_at IS NULL AND f.cancelled_at IS NULL)`,
        routeId,
        routeId,
      );
    });
  }
}

/**
 * The way back of a route: the route in use that starts where it ends and ends where it starts (Nairobi - Wote →
 * Wote - Nairobi), or null when there is none.
 */
export async function returnRouteOf(routeId) {
  const route = await getRoute(routeId);
  return route ? findWayBack(route, { activeOnly: true }) : null;
}

async function findWayBack(route, { activeOnly }) {
  const end = route.stops.at(-1);
  if (!end) return null;
  const candidates = await db.all(
    `SELECT id FROM routes WHERE id <> ? AND LOWER(origin) = LOWER(?) ${activeOnly ? 'AND is_active = TRUE' : ''} ORDER BY is_active DESC, id`,
    route.id,
    end.name,
  );
  for (const { id: backId } of candidates) {
    const back = await getRoute(backId);
    if (back.stops.at(-1)?.name.toLowerCase() === route.origin.toLowerCase()) return back;
  }
  return null;
}

/**
 * Makes sure a route in use has a way back, so its cars can turn around at the end of it. When there is none, one is
 * added: "End - Start", the same fare, the same stops in reverse, ending at the start. A way back the office switched
 * off stays off. Returns the id of the route added, or null.
 */
export async function ensureWayBack(routeId) {
  const route = await getRoute(routeId);
  const end = route?.stops.at(-1);
  if (!route?.is_active || !end || end.name.toLowerCase() === route.origin.toLowerCase()) return null;
  if (await findWayBack(route, { activeOnly: false })) return null;
  const between = route.stops.slice(0, -1).reverse().filter((s) => s.name.toLowerCase() !== route.origin.toLowerCase());
  return createRoute({
    name: `${end.name} - ${route.origin}`,
    origin: end.name,
    fare: route.fare,
    stops: [...between.map((s) => ({ name: s.name })), { name: route.origin }],
  });
}

/** Gives every route in use a way back (see ensureWayBack). Run at start-up. Returns how many were added. */
export async function everyRouteHasWayBack() {
  let added = 0;
  for (const { id: routeId } of await db.all('SELECT id FROM routes WHERE is_active = TRUE ORDER BY id')) {
    if (await ensureWayBack(routeId)) added++;
  }
  return added;
}
