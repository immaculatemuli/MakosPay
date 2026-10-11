// SACCO office dashboard: what was collected over the last 7 or 30 days (Kenyan time), by day, route,
// vehicle, drop-off stop and hour, compared with the period before. Only reads. Refunded fares are not
// counted as collected.
import { isRealMoney } from '../config.js';
import { db } from '../db.js';
import { nairobiDayRange, nairobiToday } from '../util.js';

const DAY_MS = 86_400_000;
// Kenyan calendar day / hour of an ISO time stored in UTC.
const DAY_SQL = "date(t.created_at, '+3 hours')";
const HOUR_SQL = "CAST(strftime('%H', t.created_at, '+3 hours') AS INTEGER)";

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function totals(from, to) {
  return db
    .prepare(
      `SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS collected, COUNT(DISTINCT passenger_id) AS passengers,
              COALESCE(SUM(cash_fare - fare), 0) AS passengers_saved
       FROM trips t WHERE status = 'paid' AND created_at >= ? AND created_at < ?`,
    )
    .get(from, to);
}

export function dashboard(days) {
  const lastDay = nairobiToday();
  const firstDay = addDays(lastDay, -(days - 1));
  const from = nairobiDayRange(firstDay)[0];
  const to = nairobiDayRange(lastDay)[1];
  const previousFrom = nairobiDayRange(addDays(firstDay, -days))[0];
  const all = (sql) => db.prepare(sql).all(from, to);
  const paidIn = "t.status = 'paid' AND t.created_at >= ? AND t.created_at < ?";

  const perDay = new Map(all(`SELECT ${DAY_SQL} AS date, COUNT(*) AS payments, SUM(t.fare) AS total FROM trips t WHERE ${paidIn} GROUP BY 1`).map((d) => [d.date, d]));
  const byDay = Array.from({ length: days }, (_, i) => {
    const date = addDays(firstDay, i);
    return { date, payments: perDay.get(date)?.payments ?? 0, total: perDay.get(date)?.total ?? 0 };
  });

  const refunds = db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(fare), 0) AS amount FROM trips WHERE status = 'refunded' AND created_at >= ? AND created_at < ?")
    .get(from, to);
  const topups = db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM mpesa_payments WHERE purpose = 'wallet' AND status = 'completed' AND created_at >= ? AND created_at < ?")
    .get(from, to);

  return {
    days,
    from_date: firstDay,
    to_date: lastDay,
    real_money: isRealMoney(),
    totals: totals(from, to),
    previous: totals(previousFrom, from),
    refunds,
    topups,
    by_day: byDay,
    by_route: all(
      `SELECT r.id, r.name, COUNT(*) AS payments, SUM(t.fare) AS total
       FROM trips t JOIN routes r ON r.id = t.route_id WHERE ${paidIn} GROUP BY r.id ORDER BY total DESC`,
    ),
    // Every vehicle in use, including those with no payments (so idle vehicles show).
    by_vehicle: db
      .prepare(
        `SELECT v.id, v.plate, v.owner_name, COUNT(t.id) AS payments, COALESCE(SUM(t.fare), 0) AS total
         FROM vehicles v LEFT JOIN trips t ON t.vehicle_id = v.id AND ${paidIn}
         WHERE v.is_active = 1 OR t.id IS NOT NULL GROUP BY v.id ORDER BY total DESC, v.plate`,
      )
      .all(from, to),
    top_stops: all(
      `SELECT COALESCE(t.stop_name, 'Other') AS stop_name, r.name AS route_name, COUNT(*) AS payments, SUM(t.fare) AS total
       FROM trips t JOIN routes r ON r.id = t.route_id WHERE ${paidIn} GROUP BY t.stop_name, r.id ORDER BY payments DESC, total DESC LIMIT 5`,
    ),
    by_hour: all(`SELECT ${HOUR_SQL} AS hour, COUNT(*) AS payments FROM trips t WHERE ${paidIn} GROUP BY 1 ORDER BY 1`),
  };
}
