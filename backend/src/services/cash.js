// Cash fares: the crew enter, once a day, how much cash they collected on their car (the driver can do it when
// parked, so cars without a conductor work too). It is only what they declare: it never touches wallets, payouts
// or the money check. Owners and the office see it beside the FarePay money, which is verified.
import { config } from '../config.js';
import { db, NOW } from '../database.js';
import { HttpError } from '../errors.js';
import { nairobiDayRange, nairobiToday } from '../util.js';
import { runDaily } from './jobs.js';
import { notify } from './notifications.js';

export const MAX_CASH = 200_000;

const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The cash declared on a car for a day, with who entered it (null if nothing yet). */
export async function cashFor(vehicleId, day) {
  const row = await db.get(
    `SELECT c.day, c.amount, c.updated_at, u.name AS declared_by_name
     FROM cash_declarations c JOIN users u ON u.id = c.declared_by WHERE c.vehicle_id = ? AND c.day = ?`,
    vehicleId,
    day,
  );
  return row ?? null;
}

/** The crew enter (or correct) the cash for today, or yesterday if they forgot. */
export async function declareCash(vehicleId, userId, { day, amount }) {
  const today = nairobiToday();
  if (day !== today && day !== dayBefore(today)) throw new HttpError(400, 'CASH_DAY', 'Cash can only be entered for today or yesterday.');
  await db.run(
    `INSERT INTO cash_declarations (vehicle_id, day, amount, declared_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (vehicle_id, day) DO UPDATE SET amount = excluded.amount, declared_by = excluded.declared_by, updated_at = ${NOW}`,
    vehicleId,
    day,
    amount,
    userId,
  );
  return cashFor(vehicleId, day);
}

/** A car's last `days` days for the office: FarePay fares (verified) beside the cash the crew declared. */
export async function cashAndFares(vehicleId, days = 14) {
  const out = [];
  let day = nairobiToday();
  for (let i = 0; i < days; i++, day = dayBefore(day)) {
    const [from, to] = nairobiDayRange(day);
    const fares = await db.get(
      "SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS total FROM trips WHERE vehicle_id = ? AND status = 'paid' AND created_at >= ? AND created_at < ?",
      vehicleId,
      from,
      to,
    );
    const cash = await cashFor(vehicleId, day);
    out.push({ day, farepay_payments: Number(fares.payments), farepay_total: Number(fares.total), cash: cash?.amount ?? null, cash_by: cash?.declared_by_name ?? null });
  }
  return out;
}

/** In the evening: crew of cars that worked today (FarePay fares or a trip) and have entered no cash are reminded. */
export async function remindCash(day = nairobiToday()) {
  const [from, to] = nairobiDayRange(day);
  const cars = await db.all(
    `SELECT v.id, v.conductor_id, v.driver_id FROM vehicles v
     WHERE v.is_active = TRUE
       AND NOT EXISTS (SELECT 1 FROM cash_declarations c WHERE c.vehicle_id = v.id AND c.day = ?)
       AND (EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.created_at >= ? AND t.created_at < ?)
            OR EXISTS (SELECT 1 FROM loads l WHERE l.vehicle_id = v.id AND l.started_at >= ? AND l.started_at < ?))`,
    day,
    from,
    to,
    from,
    to,
  );
  for (const car of cars) {
    const crew = [car.conductor_id, car.driver_id].filter(Boolean);
    if (crew.length) {
      await notify(crew, {
        kind: 'cash.reminder',
        title: 'How much cash did you collect today?',
        body: 'Enter today’s cash on your home screen, so the owner sees all the money the car made.',
        target: 'cash',
      });
    }
  }
  return cars.length;
}

export function startCashReminders() {
  runDaily('cash_reminder', config.cashReminderAt, async () => {
    const n = await remindCash();
    if (n) console.log(`[cash] reminded the crew of ${n} car(s) to enter today's cash`);
  });
}
