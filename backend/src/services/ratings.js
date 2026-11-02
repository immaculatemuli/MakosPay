// Passengers rate the trips they paid for: 1 to 5 stars and an optional comment, after the ride (on the ticket or
// on arriving). Only the SACCO office sees ratings: every rating with its car and crew, averages per car and per
// driver/conductor, and a notification for a low one. The crew are kept as they were when the rating was given.
import { db, NOW } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { notifyOffice } from './notifications.js';

// A trip can be rated (or its rating changed) for this long after it was paid.
const RATE_WITHIN_DAYS = 7;
// 1 or 2 stars: the office is told.
const LOW = 2;

/** The passenger rates one of their trips (rating it again changes the rating). */
export async function rateTrip(passengerId, tripId, { stars, comment = null }) {
  const trip = await db.get(
    `SELECT t.id, t.passenger_id, t.vehicle_id, t.conductor_id, t.status, t.created_at, t.ticket_code, v.plate, v.driver_id
     FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?`,
    tripId,
  );
  if (!trip || trip.passenger_id !== passengerId) throw notFound('Trip');
  if (trip.status === 'refunded') throw new HttpError(409, 'TRIP_REFUNDED', 'This fare was refunded, so the trip can’t be rated.');
  if (Date.now() - Date.parse(trip.created_at) > RATE_WITHIN_DAYS * 86_400_000) {
    throw new HttpError(400, 'TOO_OLD', `Trips can be rated for ${RATE_WITHIN_DAYS} days.`);
  }
  const before = await db.get('SELECT stars FROM trip_ratings WHERE trip_id = ?', tripId);
  await db.run(
    `INSERT INTO trip_ratings (trip_id, passenger_id, vehicle_id, driver_id, conductor_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (trip_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, updated_at = ${NOW}`,
    tripId,
    passengerId,
    trip.vehicle_id,
    trip.driver_id,
    trip.conductor_id,
    stars,
    comment,
  );
  // Told once per low rating (not again when the passenger only edits the comment).
  if (stars <= LOW && !(before && before.stars <= LOW)) {
    await notifyOffice({
      kind: 'rating.low',
      title: `${stars} star${stars === 1 ? '' : 's'} for ${trip.plate}`,
      body: comment ? `“${comment}” (ticket ${trip.ticket_code})` : `No comment. Ticket ${trip.ticket_code}.`,
      target: 'ratings',
    });
  }
  return { stars, comment };
}

/** The passenger's own ratings of these trips: { tripId: stars }. */
export async function myRatings(passengerId, tripIds) {
  if (!tripIds.length) return {};
  const rows = await db.all(
    `SELECT trip_id, stars FROM trip_ratings WHERE passenger_id = ? AND trip_id IN (${tripIds.map(() => '?').join(', ')})`,
    passengerId,
    ...tripIds,
  );
  return Object.fromEntries(rows.map((r) => [r.trip_id, r.stars]));
}

/** For the office: the newest ratings (optionally one car's, or only low ones), and averages per car and per crew. */
export async function officeRatings({ vehicleId = null, low = false, limit = 100 }) {
  const ratings = await db.all(
    `SELECT tr.id, tr.stars, tr.comment, tr.created_at, t.ticket_code, t.stop_name, r.name AS route_name,
            v.id AS vehicle_id, v.plate, d.name AS driver_name, c.name AS conductor_name, p.name AS passenger_name
     FROM trip_ratings tr
     JOIN trips t ON t.id = tr.trip_id
     JOIN routes r ON r.id = t.route_id
     JOIN vehicles v ON v.id = tr.vehicle_id
     JOIN users p ON p.id = tr.passenger_id
     LEFT JOIN users d ON d.id = tr.driver_id
     LEFT JOIN users c ON c.id = tr.conductor_id
     WHERE (CAST(? AS INTEGER) IS NULL OR tr.vehicle_id = ?) AND (? = 0 OR tr.stars <= ${LOW})
     ORDER BY tr.id DESC LIMIT ?`,
    vehicleId,
    vehicleId,
    low ? 1 : 0,
    limit,
  );
  // Lowest average first (what needs looking at). AVG comes back as text from PostgreSQL: rounded here.
  const average = async (column) =>
    (
      await db.all(
        `SELECT ${column === 'vehicle' ? 'v.id, v.plate AS name' : 'u.id, u.name'}, AVG(tr.stars) AS average, COUNT(*) AS count
       FROM trip_ratings tr ${column === 'vehicle' ? 'JOIN vehicles v ON v.id = tr.vehicle_id' : `JOIN users u ON u.id = tr.${column}_id`}
       GROUP BY ${column === 'vehicle' ? 'v.id, v.plate' : 'u.id, u.name'} ORDER BY average, count DESC`,
      )
    ).map((r) => ({ ...r, average: Math.round(Number(r.average) * 10) / 10 }));
  return {
    ratings,
    by_vehicle: await average('vehicle'),
    by_driver: await average('driver'),
    by_conductor: await average('conductor'),
  };
}
