// What the SACCO office needs to deal with now, in one list (most urgent first), and one search across everything.
// With hundreds of cars the office should only handle exceptions: each item says what is wrong, how many, and where
// to fix it (`link`, which the app and the web dashboard turn into their own screen).
import { db } from '../database.js';
import { nairobiDayRange, nairobiToday, normalizePhone } from '../util.js';

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const count = async (text, ...params) => (await db.get(text, ...params)).n;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything that needs the office, grouped by kind. `severity`: high (money or a passenger waiting),
 * medium (cars that can't work properly), low (worth a look). Empty = nothing to do.
 */
export async function needsAttention() {
  const items = [];
  const add = (item) => item.count > 0 && items.push(item);
  const [todayFrom] = nairobiDayRange(nairobiToday());

  // Money first.
  const lastCheck = await db.get("SELECT details, created_at FROM audit_log WHERE action = 'money_check.nightly' ORDER BY id DESC LIMIT 1");
  const check = lastCheck?.details ? JSON.parse(lastCheck.details) : null;
  if (check && !check.all_ok) {
    add({ key: 'money_check', severity: 'high', count: check.failed.length, title: 'The money check found a problem', detail: check.failed.join('; '), link: 'money-check' });
  }
  const manualPayouts = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payouts WHERE status = 'manual'");
  add({ key: 'payouts_manual', severity: 'high', count: manualPayouts.n, title: `${plural(manualPayouts.n, 'owner payout')} to send by hand`, detail: `KES ${manualPayouts.total.toLocaleString('en-KE')} in total. Send by M-Pesa, then record each M-Pesa code.`, link: 'payouts' });
  add({
    key: 'payouts_stuck',
    severity: 'high',
    count: await count("SELECT COUNT(*) AS n FROM payouts WHERE status = 'processing' AND created_at < ?", minutesAgo(30)),
    title: 'Owner payouts with no answer from M-Pesa',
    detail: 'Sent over 30 minutes ago. Check the M-Pesa statement, then mark each one paid or failed.',
    link: 'payouts',
  });
  add({
    key: 'payouts_failed',
    severity: 'high',
    count: await count("SELECT COUNT(*) AS n FROM payouts WHERE status = 'failed' AND created_at >= ?", daysAgo(2)),
    title: 'Owner payouts that failed',
    detail: 'In the last 2 days. Their fares are owed again and go in the next payout; check the owner’s M-Pesa or bank details.',
    link: 'payouts',
  });
  add({
    key: 'withdrawals',
    severity: 'high',
    count: await count("SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'manual' OR (status = 'processing' AND created_at < ?)", minutesAgo(30)),
    title: 'Passenger withdrawals or refunds to send',
    detail: 'Money owed back to passengers’ M-Pesa that hasn’t gone yet.',
    link: 'withdrawals',
  });

  // Passengers waiting.
  const waitingReports = await count(
    `SELECT COUNT(*) AS n FROM reports r WHERE r.status != 'resolved' AND (r.office_seen_at IS NULL OR EXISTS (
       SELECT 1 FROM report_messages m WHERE m.report_id = r.id AND m.from_office = FALSE AND m.created_at > r.office_seen_at))`,
  );
  add({ key: 'reports', severity: 'high', count: waitingReports, title: `${plural(waitingReports, 'problem report')} waiting for a reply`, detail: 'New reports, or new messages on open ones.', link: 'reports' });
  const longQueue = await db.all(
    `SELECT r.name, COUNT(*) AS n FROM seat_bookings sb JOIN routes r ON r.id = sb.route_id
     WHERE sb.status = 'queued' AND sb.queued_at < ? GROUP BY r.name ORDER BY n DESC`,
    minutesAgo(60),
  );
  const waitingLong = longQueue.reduce((n, r) => n + r.n, 0);
  add({
    key: 'queue',
    severity: 'high',
    count: waitingLong,
    title: `${plural(waitingLong, 'booked passenger')} waiting over an hour`,
    detail: longQueue.map((r) => `${r.name}: ${r.n}`).join(' · '),
    link: 'queues',
  });

  // Cars that can't work properly.
  add({
    key: 'no_route',
    severity: 'medium',
    count: await count('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = TRUE AND route_id IS NULL'),
    title: 'Cars with no route',
    detail: 'Passengers can’t pay on them until they have one.',
    link: 'vehicles:no_route',
  });
  add({
    key: 'no_driver',
    severity: 'medium',
    count: await count('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = TRUE AND driver_id IS NULL'),
    title: 'Cars with no driver set',
    detail: 'Their driver can’t see payments or pickups, and passengers can’t call them.',
    link: 'vehicles:no_driver',
  });
  add({
    key: 'parcels',
    severity: 'medium',
    count: await count("SELECT COUNT(*) AS n FROM parcels WHERE status = 'arrived' AND arrived_at < ?", daysAgo(3)),
    title: 'Parcels not collected after 3 days',
    detail: 'Call the receivers.',
    link: 'parcels',
  });

  // Worth a look.
  const hour = new Date(Date.now() + 3 * 3600_000).getUTCHours();
  if (hour >= 10) {
    add({
      key: 'idle',
      severity: 'low',
      count: await count(
        'SELECT COUNT(*) AS n FROM vehicles v WHERE v.is_active = TRUE AND v.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.created_at >= ?)',
        todayFrom,
      ),
      title: 'Cars with no FarePay payments today',
      detail: 'Off the road, or passengers paying cash: check the QR sticker is there.',
      link: 'vehicles:idle',
    });
  }
  add({
    key: 'sms_failed',
    severity: 'low',
    count: await count("SELECT COUNT(*) AS n FROM sms_outbox WHERE status = 'failed' AND created_at >= ?", daysAgo(1)),
    title: 'Text messages that could not be sent',
    detail: 'In the last day. Check the SMS account’s balance.',
    link: null,
  });

  const order = { high: 0, medium: 1, low: 2 };
  return { checked_at: new Date().toISOString(), items: items.sort((a, b) => order[a.severity] - order[b.severity]) };
}

/** Cars matching a filter from the list above: no_route | no_driver | idle (no payments today). */
export async function vehicleIdsFor(filter) {
  const [todayFrom] = nairobiDayRange(nairobiToday());
  const where = {
    no_route: 'v.is_active = TRUE AND v.route_id IS NULL',
    no_driver: 'v.is_active = TRUE AND v.driver_id IS NULL',
    idle: 'v.is_active = TRUE AND v.route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.vehicle_id = v.id AND t.created_at >= ?)',
  }[filter];
  if (!where) return null;
  const rows = await db.all(`SELECT v.id FROM vehicles v WHERE ${where}`, ...(filter === 'idle' ? [todayFrom] : []));
  return new Set(rows.map((r) => r.id));
}

/**
 * One search box for everything: a plate, a name, a phone number, a ticket, booking or parcel code. A few of each
 * kind, each with what it is and where it opens (`link`).
 */
export async function searchEverything(raw) {
  const q = raw.trim();
  if (q.length < 2) return [];
  const like = `%${q.toLowerCase()}%`;
  const code = q.toUpperCase().replace(/\s+/g, '');
  const phone = normalizePhone(q);
  const digits = q.replace(/\D/g, '');
  const results = [];

  const vehicles = await db.all(
    `SELECT v.id, v.plate, v.is_active, r.name AS route_name FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id
     WHERE REPLACE(UPPER(v.plate), ' ', '') LIKE ? ORDER BY v.plate LIMIT 6`,
    `%${code}%`,
  );
  for (const v of vehicles) results.push({ kind: 'vehicle', id: v.id, title: v.plate, subtitle: `${v.route_name ?? 'No route'}${v.is_active ? '' : ' · switched off'}`, link: `vehicle:${v.id}` });

  const people = await db.all(
    `SELECT id, name, phone, role, is_active FROM users
     WHERE phone NOT LIKE 'deleted-%' AND (LOWER(name) LIKE ? OR phone = ? OR (CAST(? AS TEXT) <> '' AND phone LIKE ?))
     ORDER BY name LIMIT 8`,
    like,
    phone ?? '',
    digits.length >= 4 ? digits : '',
    `%${digits.length >= 4 ? digits.replace(/^0/, '') : '#'}%`,
  );
  const roleWord = { passenger: 'Passenger', driver: 'Driver', conductor: 'Conductor', marshal: 'Stage marshal', admin: 'Office', platform_admin: 'Platform admin' };
  for (const p of people) {
    const link = p.role === 'passenger' ? `passenger:${p.phone}` : ['driver', 'conductor', 'marshal'].includes(p.role) ? `crew:${p.role}` : 'staff';
    results.push({ kind: 'person', id: p.id, title: p.name, subtitle: `${roleWord[p.role] ?? p.role} · 0${p.phone.slice(3)}${p.is_active ? '' : ' · switched off'}`, link });
  }

  if (code.length >= 4) {
    const trips = await db.all(
      `SELECT t.id, t.ticket_code, t.fare, t.status, t.stop_name, t.payout_id, t.created_at, v.plate, u.name AS passenger_name
       FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = t.passenger_id WHERE t.ticket_code = ? LIMIT 3`,
      code,
    );
    for (const t of trips) {
      results.push({
        kind: 'payment',
        id: t.id,
        title: `Ticket ${t.ticket_code}`,
        subtitle: `${t.plate} · KES ${t.fare} · ${t.passenger_name}${t.status === 'refunded' ? ' · refunded' : ''}`,
        // The day it was paid (Kenyan time) opens that day's payments; the rest opens the refund screen in the app.
        link: `payments:${new Date(Date.parse(t.created_at) + 3 * 3600_000).toISOString().slice(0, 10)}`,
        payment: { id: t.id, ticket: t.ticket_code, fare: t.fare, plate: t.plate, stop: t.stop_name ?? '', passenger: t.passenger_name, paid_out: Boolean(t.payout_id), refunded: t.status === 'refunded' },
      });
    }
    const seats = await db.all(
      `SELECT sb.id, sb.code, sb.status, sb.seats, r.name AS route_name FROM seat_bookings sb JOIN routes r ON r.id = sb.route_id WHERE sb.code = ? LIMIT 3`,
      code,
    );
    for (const b of seats) results.push({ kind: 'booking', id: b.id, title: `Booking ${b.code}`, subtitle: `${b.route_name} · ${plural(b.seats, 'seat')} · ${b.status}`, link: 'queues' });
    const parcels = await db.all('SELECT id, tracking_code, status, receiver_name FROM parcels WHERE tracking_code = ? LIMIT 3', code);
    for (const p of parcels) results.push({ kind: 'parcel', id: p.id, title: `Parcel ${p.tracking_code}`, subtitle: `For ${p.receiver_name} · ${p.status.replace(/_/g, ' ')}`, link: `parcel:${p.id}` });
  }
  return results;
}
