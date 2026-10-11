// Vehicle runs: a trip from start to end, started and ended by the conductor or driver. Fares paid while a
// run is open belong to it, so crew and office see what was collected on each trip.
// Passengers can always pay, whether or not a run is open.
import { db, insertId, NOW } from '../db.js';
import { HttpError, notFound } from '../errors.js';

export const openRun = (vehicleId) => db.prepare('SELECT * FROM vehicle_runs WHERE vehicle_id = ? AND ended_at IS NULL').get(vehicleId);

const RUN_SELECT = `
  SELECT r.*, rt.name AS route_name, s.name AS started_by_name, e.name AS ended_by_name,
         (SELECT COUNT(*) FROM trips t WHERE t.run_id = r.id AND t.status = 'paid') AS payments,
         (SELECT COALESCE(SUM(fare), 0) FROM trips t WHERE t.run_id = r.id AND t.status = 'paid') AS total
  FROM vehicle_runs r
  LEFT JOIN routes rt ON rt.id = r.route_id
  JOIN users s ON s.id = r.started_by
  LEFT JOIN users e ON e.id = r.ended_by`;

/** One run with its collection summary, including a breakdown per drop-off stop. */
export function getRun(runId) {
  const run = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(runId);
  if (!run) return null;
  const byStop = db
    .prepare(
      `SELECT COALESCE(stop_name, 'Other') AS stop_name, COUNT(*) AS payments, SUM(fare) AS total
       FROM trips WHERE run_id = ? AND status = 'paid' GROUP BY stop_name ORDER BY total DESC`,
    )
    .all(runId);
  return { ...run, by_stop: byStop };
}

/** Runs of one vehicle that started in [from, to), newest first, with their totals. */
export const listRuns = (vehicleId, from, to) =>
  db.prepare(`${RUN_SELECT} WHERE r.vehicle_id = ? AND r.started_at >= ? AND r.started_at < ? ORDER BY r.id DESC`).all(vehicleId, from, to);

export function startRun(vehicle, user) {
  if (!vehicle.route_id) throw new HttpError(409, 'NO_ROUTE', 'Set the route before starting a trip.');
  if (openRun(vehicle.id)) throw new HttpError(409, 'TRIP_ALREADY_STARTED', 'A trip is already in progress on this vehicle. End it first.');
  return getRun(insertId(db.prepare('INSERT INTO vehicle_runs (vehicle_id, route_id, started_by) VALUES (?, ?, ?)').run(vehicle.id, vehicle.route_id, user.id)));
}

export function endRun(vehicle, user, runId) {
  const run = db.prepare('SELECT * FROM vehicle_runs WHERE id = ?').get(runId);
  if (!run || run.vehicle_id !== vehicle.id) throw notFound('Trip');
  if (run.ended_at) throw new HttpError(409, 'TRIP_ALREADY_ENDED', 'This trip has already ended.');
  db.prepare(`UPDATE vehicle_runs SET ended_at = ${NOW}, ended_by = ? WHERE id = ?`).run(user.id, runId);
  return getRun(runId);
}
