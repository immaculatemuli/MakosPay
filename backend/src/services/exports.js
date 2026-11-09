// Reports for the accountant, downloaded as CSV files that open straight in Excel: takings per day, car, owner and
// route, every payment, and every owner payout, for any period (Kenyan dates, from–to inclusive).
import { db } from '../database.js';
import { HttpError } from '../errors.js';
import { nairobiDayRange } from '../util.js';

export const EXPORTS = {
  daily: 'Takings per day',
  vehicles: 'Takings per car',
  owners: 'Takings per owner',
  routes: 'Takings per route',
  payments: 'Every payment',
  payouts: 'Owner payouts',
};

const NAIROBI_MS = 3 * 3600_000;
const day = (iso) => new Date(Date.parse(iso) + NAIROBI_MS).toISOString().slice(0, 10);
const hm = (iso) => new Date(Date.parse(iso) + NAIROBI_MS).toISOString().slice(11, 16);
const phone = (p) => (p?.startsWith('254') ? `0${p.slice(3)}` : (p ?? ''));

/** One CSV cell: quoted when needed; a leading 0 kept as text (phone numbers), a leading = or + made safe. */
function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`; // never a formula
  if (/^0\d{8,}$/.test(text)) return `="${text}"`; // keep 0712... as typed
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csv = (headings, rows) => '﻿' + [headings, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

// Paid fares (not refunded) of the period, used by most reports. Free rides count: the owner was paid them.
const PAID = "t.status = 'paid' AND t.created_at >= ? AND t.created_at < ?";

/** The report as CSV text and its file name. */
export async function exportReport(kind, fromDate, toDate) {
  if (!EXPORTS[kind]) throw new HttpError(404, 'NOT_FOUND', 'Unknown report');
  if (toDate < fromDate) throw new HttpError(400, 'BAD_DATES', 'The end date is before the start date');
  if (Date.parse(toDate) - Date.parse(fromDate) > 366 * 86_400_000) throw new HttpError(400, 'BAD_DATES', 'At most one year at a time');
  const from = nairobiDayRange(fromDate)[0];
  const to = nairobiDayRange(toDate)[1];
  const name = `FarePay ${EXPORTS[kind]} ${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ''}.csv`;

  if (kind === 'daily') {
    const trips = await db.all('SELECT created_at, fare, status, free_ride FROM trips WHERE created_at >= ? AND created_at < ?', from, to);
    const days = new Map();
    for (let d = fromDate; d <= toDate; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
      days.set(d, { payments: 0, total: 0, free: 0, refunds: 0, refunded: 0 });
    }
    for (const t of trips) {
      const row = days.get(day(t.created_at));
      if (!row) continue;
      if (t.status === 'refunded') {
        row.refunds += 1;
        row.refunded += t.fare;
      } else {
        row.payments += 1;
        row.total += t.fare;
        if (t.free_ride) row.free += t.fare;
      }
    }
    const rows = [...days].map(([d, r]) => [d, r.payments, r.total, r.free, r.refunds, r.refunded]);
    const sum = (i) => rows.reduce((n, r) => n + r[i], 0);
    rows.push(['TOTAL', sum(1), sum(2), sum(3), sum(4), sum(5)]);
    return { name, text: csv(['Date', 'Payments', 'Collected (KES)', 'Of which free rides paid by SACCO (KES)', 'Refunds', 'Refunded (KES)'], rows) };
  }

  if (kind === 'vehicles') {
    const rows = await db.all(
      `SELECT v.plate, v.owner_name, v.owner_phone, r.name AS route_name, COUNT(t.id) AS payments, COALESCE(SUM(t.fare), 0) AS total
       FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id LEFT JOIN trips t ON t.vehicle_id = v.id AND ${PAID}
       GROUP BY v.id, v.plate, v.owner_name, v.owner_phone, r.name ORDER BY total DESC, v.plate`,
      from,
      to,
    );
    return {
      name,
      text: csv(
        ['Plate', 'Owner', 'Owner phone', 'Route', 'Payments', 'Collected (KES)'],
        rows.map((v) => [v.plate, v.owner_name, phone(v.owner_phone), v.route_name ?? '', v.payments, v.total]),
      ),
    };
  }

  if (kind === 'owners') {
    const owners = await db.all('SELECT id, name, phone, payout_method, bank_name FROM owners ORDER BY name');
    const rows = [];
    for (const o of owners) {
      const takings = await db.get(
        `SELECT COUNT(DISTINCT v.id) AS cars, COUNT(t.id) AS payments, COALESCE(SUM(t.fare), 0) AS total
         FROM vehicles v LEFT JOIN trips t ON t.vehicle_id = v.id AND ${PAID} WHERE v.owner_id = ?`,
        from,
        to,
        o.id,
      );
      const paid = await db.get(
        "SELECT COALESCE(SUM(amount), 0) AS n FROM payouts WHERE (owner_id = ? OR owner_phone = ?) AND status = 'completed' AND completed_at >= ? AND completed_at < ?",
        o.id,
        o.phone,
        from,
        to,
      );
      rows.push([o.name, phone(o.phone), o.payout_method === 'bank' ? `Bank (${o.bank_name ?? ''})` : 'M-Pesa', takings.cars, takings.payments, takings.total, paid.n]);
    }
    return { name, text: csv(['Owner', 'Phone', 'Paid by', 'Cars', 'Payments', 'Collected (KES)', 'Paid out in the period (KES)'], rows) };
  }

  if (kind === 'routes') {
    const rows = await db.all(
      `SELECT r.name, r.origin, COUNT(t.id) AS payments, COALESCE(SUM(t.fare), 0) AS total
       FROM routes r LEFT JOIN trips t ON t.route_id = r.id AND ${PAID} GROUP BY r.id, r.name, r.origin ORDER BY total DESC, r.name`,
      from,
      to,
    );
    return { name, text: csv(['Route', 'Starts from', 'Payments', 'Collected (KES)'], rows.map((r) => [r.name, r.origin, r.payments, r.total])) };
  }

  if (kind === 'payments') {
    const rows = await db.all(
      `SELECT t.created_at, t.ticket_code, v.plate, r.name AS route_name, t.stop_name, t.fare, t.status, t.free_ride, t.owner_name,
              p.name AS passenger_name, t.refund_reason
       FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN routes r ON r.id = t.route_id JOIN users p ON p.id = t.passenger_id
       WHERE t.created_at >= ? AND t.created_at < ? ORDER BY t.id LIMIT 200000`,
      from,
      to,
    );
    return {
      name,
      text: csv(
        ['Date', 'Time', 'Ticket', 'Plate', 'Route', 'Drop-off', 'Fare (KES)', 'Status', 'Free ride', 'Owner', 'Passenger', 'Refund reason'],
        rows.map((t) => [day(t.created_at), hm(t.created_at), t.ticket_code, t.plate, t.route_name, t.stop_name ?? '', t.fare, t.status, t.free_ride ? 'yes' : '', t.owner_name, t.passenger_name, t.refund_reason ?? '']),
      ),
    };
  }

  // payouts
  const rows = await db.all('SELECT * FROM payouts WHERE created_at >= ? AND created_at < ? ORDER BY id', from, to);
  return {
    name,
    text: csv(
      ['Date', 'Time', 'Owner', 'Owner phone', 'Fares', 'Amount (KES)', 'Paid to', 'Status', 'M-Pesa code'],
      rows.map((p) => [
        day(p.created_at),
        hm(p.created_at),
        p.owner_name,
        phone(p.owner_phone),
        p.trip_count,
        p.amount,
        p.method === 'bank' ? `${p.bank_name ?? 'Bank'} ${p.bank_account ?? ''}`.trim() : 'M-Pesa',
        p.status,
        p.reference ?? '',
      ]),
    ),
  };
}
