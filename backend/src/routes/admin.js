// SACCO office: routes and fares, conductors and drivers, vehicles (with the owner's payout details) and QR stickers.
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { db, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import * as mpesa from '../services/mpesa.js';
import { completePayout, createPayout, failPayout, faresWaitingForDrivers, getPayout, owedByOwner, payEveryone } from '../services/payouts.js';
import { audit, listAudit } from '../services/audit.js';
import { cashAndFares } from '../services/cash.js';
import { checkStatement } from '../services/statement.js';
import { completeWithdrawal, failWithdrawal, WITHDRAWAL_SELECT } from '../services/withdrawals.js';
import { dashboard } from '../services/dashboard.js';
import { reconcile } from '../services/reconciliation.js';
import {
  cancelFareChange,
  createRoute,
  getRoute,
  listRoutes,
  routeFareChanges,
  scheduleFareChange,
  stopsSchema,
  updateRoute,
  withOneFare,
} from '../services/routes.js';
import { officeTrip, officeTrips } from '../services/bookings.js';
import { needsAttention, searchEverything, vehicleIdsFor } from '../services/attention.js';
import { AUDIENCES, recipients, sendBroadcast } from '../services/broadcast.js';
import { EXPORTS, exportReport } from '../services/exports.js';
import { importRows, IMPORT_KINDS, TEMPLATES } from '../services/importer.js';
import { createOwner, findOrCreateOwner, getOwner, linkVehicle, listOwners, ownerDetail, updateOwner } from '../services/owners.js';
import { cancelParcel, collectParcel, createParcel, listParcels, recordPayment, refreshedParcel, sendParcelPrompt } from '../services/parcels.js';
import { getPhoto, officeReply, officeReports, replySchema, sendPhoto, updateReport } from '../services/reports.js';
import { approveRefund, declineRefund, listRefundRequests } from '../services/refundRequests.js';
import { officeRatings } from '../services/ratings.js';
import { syncTrackers, trackerOn, trackerStatus } from '../services/tracker.js';
import { refundTrip, TRIP_SELECT } from '../services/trips.js';
import { createUser, deleteCrewMember, resetPassword } from '../services/users.js';
import { nairobiDayRange, nairobiToday, newQrToken } from '../util.js';

/** YYYY-MM-DD in Kenya, days from today. */
const nairobiDate = (days) => new Date(Date.now() + 3 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
import { id, kes, name, parse, password, phone } from '../validate.js';

const router = Router();

/** UPDATE table SET <only the provided fields> WHERE id = ? (used for vehicles). Field names come from zod schemas, never from raw input. */
async function updateRow(table, rowId, fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HttpError(400, 'NOTHING_TO_UPDATE', 'Nothing to update');
  const result = await db.run(`UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...entries.map(([, v]) => v), rowId);
  if (result.changes === 0) throw notFound('Vehicle');
}

// ---------- Home dashboard ----------

router.get('/summary', async (_req, res) => {
  const count = async (text) => (await db.get(text)).n;
  const [from, to] = nairobiDayRange(nairobiToday());
  res.json({
    routes: await count('SELECT COUNT(*) AS n FROM routes WHERE is_active = TRUE'),
    vehicles: await count('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = TRUE'),
    vehicles_without_route: await count('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = TRUE AND route_id IS NULL'),
    conductors: await count("SELECT COUNT(*) AS n FROM users WHERE role = 'conductor' AND is_active = TRUE"),
    drivers: await count("SELECT COUNT(*) AS n FROM users WHERE role = 'driver' AND is_active = TRUE"),
    passengers: await count("SELECT COUNT(*) AS n FROM users WHERE role = 'passenger'"),
    today: await daySummary(from, to),
    owed_to_owners: (await owedByOwner()).reduce((sum, o) => sum + o.amount, 0),
    open_reports: await count("SELECT COUNT(*) AS n FROM reports WHERE status != 'resolved'"),
  });
});

// Collections over the last 7 or 30 days: by day, route, vehicle, stop and hour, with the period before.
router.get('/dashboard', async (req, res) => {
  const { days } = parse(z.object({ days: z.enum(['7', '30']).default('7').transform(Number) }), req.query);
  res.json(await dashboard(days));
});

// ---------- Payments ----------

async function daySummary(from, to) {
  return {
    ...(await db.get("SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS total FROM trips WHERE status = 'paid' AND created_at >= ? AND created_at < ?", from, to)),
    by_vehicle: await db.all(
      `SELECT v.id, v.plate, v.owner_name, COUNT(*) AS payments, SUM(t.fare) AS total
       FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.status = 'paid' AND t.created_at >= ? AND t.created_at < ? GROUP BY v.id ORDER BY total DESC, v.plate`,
      from,
      to,
    ),
  };
}

// Every payment on one day (default today, Kenyan time), optionally for one vehicle.
router.get('/payments', async (req, res) => {
  const { date, vehicle_id } = parse(z.object({ date: z.string().date().default(nairobiToday), vehicle_id: id.optional() }), req.query);
  const [from, to] = nairobiDayRange(date);
  const payments = await db.all(
    `${TRIP_SELECT} WHERE t.created_at >= ? AND t.created_at < ? AND (CAST(? AS INTEGER) IS NULL OR t.vehicle_id = ?) ORDER BY t.id DESC LIMIT 500`,
    from,
    to,
    vehicle_id ?? null,
    vehicle_id ?? null,
  );
  res.json({ date, summary: await daySummary(from, to), payments });
});

// Refund a fare to the passenger's wallet (vehicle broke down, wrong charge...).
router.post('/payments/:id/refund', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(await refundTrip(parse(id, req.params.id), reason));
});

// GPS trackers in the cars: is the connection working, which tracker is on which car, where each car is.
router.get('/tracker', async (_req, res) => {
  res.json(await trackerStatus());
});

// Read the trackers now instead of waiting for the next automatic read.
router.post('/tracker/check', async (_req, res) => {
  if (!trackerOn) throw new HttpError(400, 'TRACKER_OFF', 'No tracking system is connected (TRACKER_PROVIDER is off).');
  await syncTrackers().catch(() => {}); // the error is shown in the status
  res.json(await trackerStatus());
});

// "Paid by mistake" requests from conductors and drivers: ?status=waiting (default) or all.
// Passengers' trip ratings: the newest (one car's, or only 1–2 stars), and averages per car, driver and conductor.
router.get('/ratings', async (req, res) => {
  const q = parse(z.object({ vehicle_id: id.optional(), low: z.enum(['1', '0']).default('0') }), req.query);
  res.json(await officeRatings({ vehicleId: q.vehicle_id ?? null, low: q.low === '1' }));
});

router.get('/refund-requests', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['waiting', 'all']).default('waiting') }), req.query);
  res.json({ requests: await listRefundRequests({ status }) });
});

router.post('/refund-requests/:id/approve', async (req, res) => {
  res.json(await approveRefund(parse(id, req.params.id), req.user.id));
});

router.post('/refund-requests/:id/decline', async (req, res) => {
  const { note } = parse(z.object({ note: z.string().trim().min(3).max(200) }), req.body);
  res.json(await declineRefund(parse(id, req.params.id), req.user.id, note));
});

// ---------- Problem reports ----------

// Reports, newest first, with their conversations; ?status=open|in_progress|resolved to filter.
router.get('/reports', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['open', 'in_progress', 'resolved']).optional() }), req.query);
  res.json(await officeReports(status));
});

// A photo the reporter added to their report.
router.get('/reports/:id/photos/:photoId', async (req, res) => {
  const photo = await getPhoto(parse(id, req.params.id), parse(id, req.params.photoId));
  sendPhoto(res, photo);
});

// The office writes to the reporter on their report.
router.post('/reports/:id/messages', async (req, res) => {
  res.status(201).json(await officeReply(req.user.id, parse(id, req.params.id), parse(replySchema, req.body)));
});

router.patch('/reports/:id', async (req, res) => {
  const body = parse(
    z.object({ status: z.enum(['open', 'in_progress', 'resolved']), office_note: z.string().trim().min(2).max(1000).optional() }),
    req.body,
  );
  res.json(await updateReport(parse(id, req.params.id), req.user.id, body));
});

// ---------- Owner payouts ----------

router.get('/payouts/owed', async (_req, res) => {
  res.json({
    owners: await owedByOwner(),
    automatic: mpesa.isConfigured.b2c,
    daily_at: config.payoutDailyAt,
    // Fares the cars' drivers have not yet sent to the owners (only paid out once they do).
    waiting_for_drivers: config.payoutsNeedDriver ? await faresWaitingForDrivers() : null,
  });
});

router.get('/payouts', async (_req, res) => {
  res.json(await db.all('SELECT * FROM payouts ORDER BY id DESC LIMIT 200'));
});

router.get('/payouts/:id', async (req, res) => {
  const payout = await getPayout(parse(id, req.params.id));
  if (!payout) throw notFound('Payout');
  const trips = await db.all(`${TRIP_SELECT} WHERE t.payout_id = ? ORDER BY t.id`, payout.id);
  res.json({ ...payout, trips });
});

// Pay one owner now (by their M-Pesa number). `manual: true` = the office sends the money itself.
router.post('/payouts', async (req, res) => {
  const body = parse(z.object({ owner_phone: phone, manual: z.boolean().default(false) }), req.body);
  res.status(201).json(await createPayout(body.owner_phone, req.user.id, { manual: body.manual }));
});

// Pay every owner who is owed something, now (the same as the automatic daily run).
router.post('/payouts/run', async (req, res) => {
  res.json(await payEveryone(req.user.id));
});

// The office sent the money itself (or confirmed it on the M-Pesa statement): record the M-Pesa code.
router.post('/payouts/:id/complete', async (req, res) => {
  const { reference } = parse(z.object({ reference: z.string().trim().min(3).max(100) }), req.body);
  res.json(await completePayout(parse(id, req.params.id), reference));
});

// The money did not reach the owner: the fares go back to "owed".
router.post('/payouts/:id/fail', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(await failPayout(parse(id, req.params.id), reason));
});

// ---------- Passenger withdrawals (wallet money back to M-Pesa) ----------

// Waiting ones first (the office may need to send them), then the latest finished ones.
router.get('/withdrawals', async (_req, res) => {
  res.json({
    automatic: mpesa.isConfigured.b2c,
    open: await db.all(`${WITHDRAWAL_SELECT} WHERE w.status IN ('processing', 'manual') ORDER BY w.id`),
    recent: await db.all(`${WITHDRAWAL_SELECT} WHERE w.status IN ('completed', 'failed') ORDER BY w.id DESC LIMIT 50`),
  });
});

// The office sent the money itself: record the M-Pesa code.
router.post('/withdrawals/:id/complete', async (req, res) => {
  const { reference } = parse(z.object({ reference: z.string().trim().min(3).max(100) }), req.body);
  res.json(await completeWithdrawal(parse(id, req.params.id), reference.toUpperCase(), req.user.id));
});

// It could not be sent: the money goes back into the passenger's wallet.
router.post('/withdrawals/:id/fail', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(await failWithdrawal(parse(id, req.params.id), reason, req.user.id));
});

// ---------- M-Pesa statement check ----------

// The CSV statement from the M-Pesa org portal, as text. Only reads; the result is kept in the audit log.
router.post('/statement-check', async (req, res) => {
  const { csv } = parse(z.object({ csv: z.string().min(1).max(5_000_000) }), req.body);
  let result;
  try {
    result = await checkStatement(csv);
  } catch (err) {
    throw new HttpError(400, 'BAD_STATEMENT', err.message);
  }
  await audit(req.user, 'statement.check', null, null, {
    period: result.period,
    all_ok: result.all_ok,
    matched_in: result.money_in.matched,
    matched_out: result.money_out.matched,
    problems: result.money_in.wrong_amount.length + result.money_in.not_in_farepay.length + result.money_out.wrong_amount.length + result.money_out.not_in_farepay.length + result.not_in_statement.length,
  });
  res.json(result);
});

// ---------- Routes & fares ----------

// A route has a name, a starting point, and drop-off stops along the way, each with its own fares.

router.get('/routes', async (_req, res) => {
  res.json(await listRoutes());
});

router.get('/routes/:id', async (req, res) => {
  const route = await getRoute(parse(id, req.params.id));
  if (!route) throw notFound('Route');
  res.json(route);
});

router.post('/routes', async (req, res) => {
  const body = parse(z.object({ name, origin: name, stops: stopsSchema }), req.body);
  res.status(201).json(await getRoute(await createRoute(body, req.user.id)));
});

// Fare history for a route: changes already in effect, waiting for their date, and cancelled.
router.get('/routes/:id/fare-changes', async (req, res) => {
  res.json(await routeFareChanges(parse(id, req.params.id)));
});

// Set a stop's fare ({ fare }) from a date (YYYY-MM-DD, Kenyan time). Today or earlier applies at once; past payments keep their fares.
router.post('/stops/:id/fare-change', async (req, res) => {
  const body = parse(
    z
      .preprocess(withOneFare, z.object({ cash_fare: kes, app_fare: kes, effective_date: z.string().date(), reason: z.string().trim().max(200).optional() }))
      .refine((f) => f.app_fare <= f.cash_fare, { path: ['app_fare'], message: 'App fare cannot be more than the cash fare' })
      .refine((f) => f.effective_date <= nairobiDate(366), { path: ['effective_date'], message: 'Choose a date within the next year' }),
    req.body,
  );
  res.status(201).json(await scheduleFareChange(parse(id, req.params.id), body, req.user.id));
});

router.post('/fare-changes/:id/cancel', async (req, res) => {
  res.json(await cancelFareChange(parse(id, req.params.id)));
});

// Send `stops` to replace the list of stops (in order): stops with an id are updated, new ones added,
// and stops left out are switched off.
router.patch('/routes/:id', async (req, res) => {
  const routeId = parse(id, req.params.id);
  const body = parse(
    z.object({ name: name.optional(), origin: name.optional(), is_active: z.boolean().optional(), stops: stopsSchema.optional() }),
    req.body,
  );
  await updateRoute(routeId, body, req.user.id);
  res.json(await getRoute(routeId));
});

// ---------- Audit log & reconciliation ----------

// Who did what, newest first. ?before=<id> for the next page; ?entity=&entity_id= for one record's history.
router.get('/audit', async (req, res) => {
  const q = parse(
    z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      before: z.coerce.number().int().positive().optional(),
      entity: z.string().max(40).optional(),
      entity_id: z.coerce.number().int().positive().optional(),
    }),
    req.query,
  );
  const items = await listAudit({ before: q.before, limit: q.limit, entity: q.entity, entityId: q.entity_id });
  res.json({ items, next_before: items.length === q.limit ? items.at(-1).id : null });
});

// Checks that wallets, M-Pesa, fares and payouts all add up.
router.get('/reconciliation', async (_req, res) => {
  res.json(await reconcile());
});

// ---------- Vehicle crew (conductors and drivers) and stage marshals ----------
// All work the same way (marshals have no vehicle): the office creates their sign-in, puts them on one vehicle, and can switch them off
// or delete them (deleted people are no longer listed; see deleteCrewMember).

const CREW = {
  conductor: { path: 'conductors', column: 'conductor_id', label: 'Conductor' },
  driver: { path: 'drivers', column: 'driver_id', label: 'Driver' },
  marshal: { path: 'marshals', column: null, label: 'Marshal' },
};

for (const [role, { path, column, label }] of Object.entries(CREW)) {
  const SELECT = `
    SELECT u.id, u.name, u.phone, u.is_active, u.created_at, ${column ? 'v.id AS vehicle_id, v.plate AS vehicle_plate' : 'NULL AS vehicle_id, NULL AS vehicle_plate'}
    FROM users u ${column ? `LEFT JOIN vehicles v ON v.${column} = u.id` : ''}
    WHERE u.role = '${role}' AND u.phone NOT LIKE 'deleted-%'`;

  router.get(`/${path}`, async (_req, res) => {
    res.json(await db.all(`${SELECT} ORDER BY u.is_active DESC, u.name`));
  });

  router.post(`/${path}`, async (req, res) => {
    const body = parse(z.object({ name, phone, password }), req.body);
    const user = await createUser({ ...body, role });
    res.status(201).json(await db.get(`${SELECT} AND u.id = ?`, user.id));
  });

  // Switching someone off signs them out and frees their vehicle for someone else.
  router.patch(`/${path}/:id`, async (req, res) => {
    const userId = parse(id, req.params.id);
    const body = parse(z.object({ name: name.optional(), is_active: z.boolean().optional() }), req.body);
    const result = await db.run(
      "UPDATE users SET name = COALESCE(?, name), is_active = COALESCE(?, is_active) WHERE id = ? AND role = ? AND phone NOT LIKE 'deleted-%'",
      body.name ?? null,
      body.is_active ?? null,
      userId,
      role,
    );
    if (result.changes === 0) throw notFound(label);
    if (body.is_active === false && column) await db.run(`UPDATE vehicles SET ${column} = NULL WHERE ${column} = ?`, userId);
    res.json(await db.get(`${SELECT} AND u.id = ?`, userId));
  });

  router.post(`/${path}/:id/delete`, async (req, res) => {
    if (!(await deleteCrewMember(parse(id, req.params.id), role, column))) throw notFound(label);
    res.json({ ok: true });
  });
}

// ---------- SACCO office staff ----------

router.get('/staff', async (_req, res) => {
  res.json(await db.all("SELECT id, name, phone, is_active, created_at FROM users WHERE role = 'admin' ORDER BY is_active DESC, name"));
});

router.post('/staff', async (req, res) => {
  const body = parse(z.object({ name, phone, password }), req.body);
  const user = await createUser({ ...body, role: 'admin' });
  res.status(201).json(user);
});

// Switch a staff account off or on. Nobody can switch off their own account (so the office is never locked out).
router.patch('/staff/:id', async (req, res) => {
  const staffId = parse(id, req.params.id);
  const { is_active } = parse(z.object({ is_active: z.boolean() }), req.body);
  if (staffId === req.user.id && !is_active) throw new HttpError(400, 'CANNOT_DISABLE_SELF', 'You cannot switch off your own account');
  const result = await db.run("UPDATE users SET is_active = ? WHERE id = ? AND role = 'admin'", is_active, staffId);
  if (result.changes === 0) throw notFound('Staff account');
  res.json(await db.get('SELECT id, name, phone, is_active, created_at FROM users WHERE id = ?', staffId));
});

// ---------- Passengers & passwords ----------

// Passengers, newest first; `q` searches by name (any capitals) or phone number.
router.get('/passengers', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(50).optional() }), req.query);
  const digits = q?.replace(/\D/g, '').replace(/^0/, '') ?? '';
  const rows = await db.all(
    `SELECT u.id, u.name, u.phone, u.is_active, u.created_at, w.balance AS wallet_balance,
            (SELECT COUNT(*) FROM trips t WHERE t.passenger_id = u.id) AS trips
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id
     WHERE u.role = 'passenger' AND (? = '' OR lower(u.name) LIKE lower(?) OR (? != '' AND u.phone LIKE ?))
     ORDER BY u.id DESC LIMIT 100`,
    q ?? '',
    `%${q ?? ''}%`,
    digits,
    `%${digits}%`,
  );
  res.json(rows);
});

// A passenger or conductor forgot their password: the office sets a new one and tells them.
router.post('/users/:id/password', async (req, res) => {
  const { new_password } = parse(z.object({ new_password: password }), req.body);
  await resetPassword(parse(id, req.params.id), new_password);
  res.json({ ok: true });
});

// ---------- Vehicles & QR stickers ----------

const VEHICLE_SELECT = `
  SELECT v.*, c.name AS conductor_name, c.phone AS conductor_phone, d.name AS driver_name, r.name AS route_name, r.origin
  FROM vehicles v
  LEFT JOIN users c ON c.id = v.conductor_id
  LEFT JOIN users d ON d.id = v.driver_id
  LEFT JOIN routes r ON r.id = v.route_id`;

const getVehicle = (vehicleId) => db.get(`${VEHICLE_SELECT} WHERE v.id = ?`, vehicleId);

const plate = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .transform((p) => p.toUpperCase().replace(/\s+/g, ' '));
const optionalText = z.string().trim().max(100).transform((t) => t || null);
// Passenger seats, for seat booking.
const seatCount = z.number().int().min(1, 'At least 1 seat').max(80, 'At most 80 seats');

// How the owner is paid: M-Pesa (to owner_phone) or a bank account (through the bank's M-Pesa paybill).
const payoutFields = {
  owner_payout_method: z.enum(['mpesa', 'bank']).optional(),
  owner_bank_name: z.string().trim().max(60).transform((t) => t || null).nullable().optional(),
  owner_bank_paybill: z
    .string()
    .trim()
    .regex(/^\d{5,7}$/, "The bank's M-Pesa paybill number (5 to 7 digits)")
    .nullable()
    .optional(),
  owner_bank_account: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,30}$/, 'Bank account number (letters, numbers or -)')
    .nullable()
    .optional(),
};

/** A bank owner needs the bank name, its paybill and their account number. Checks the values as they will be saved. */
function checkPayoutDetails(v) {
  if (v.owner_payout_method !== 'bank') return;
  const missing = ['owner_bank_name', 'owner_bank_paybill', 'owner_bank_account'].filter((f) => !v[f]);
  if (missing.length) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', missing.map((field) => ({ field, message: 'Required for bank payouts' })));
  }
}

/** The route exists, and the conductor/driver chosen is an active account of that role not on another vehicle. */
async function checkVehicleLinks(fields, vehicleId = null) {
  if (fields.route_id != null && !(await getRoute(fields.route_id))) throw notFound('Route');
  for (const [role, { column, label }] of Object.entries(CREW)) {
    if (!column) continue; // marshals have no vehicle
    const userId = fields[column];
    if (userId == null) continue;
    const person = await db.get('SELECT is_active FROM users WHERE id = ? AND role = ?', userId, role);
    if (!person) throw new HttpError(400, `NOT_A_${role.toUpperCase()}`, `Choose a ${role} account`);
    if (!person.is_active) throw new HttpError(400, `${role.toUpperCase()}_DISABLED`, `This ${role} account is switched off`);
    const other = await db.get(`SELECT plate FROM vehicles WHERE ${column} = ? AND id IS DISTINCT FROM CAST(? AS INTEGER)`, userId, vehicleId);
    if (other) throw new HttpError(409, `${role.toUpperCase()}_TAKEN`, `This ${label.toLowerCase()} already works on ${other.plate}`);
  }
}

// All vehicles, or (?filter=) only those needing attention: no_route | no_driver | idle (no payments today).
router.get('/vehicles', async (req, res) => {
  const { filter } = parse(z.object({ filter: z.enum(['no_route', 'no_driver', 'idle']).optional() }), req.query);
  const rows = await db.all(`${VEHICLE_SELECT} ORDER BY v.is_active DESC, v.plate`);
  const only = filter ? await vehicleIdsFor(filter) : null;
  res.json(only ? rows.filter((v) => only.has(v.id)) : rows);
});

// What needs the office now, most urgent first, and one search across cars, people, tickets, bookings and parcels.
router.get('/attention', async (_req, res) => {
  res.json(await needsAttention());
});

// ---------- Spreadsheet import (routes, crew, vehicles) and every QR sticker at once ----------

router.get('/import/templates', (_req, res) => {
  res.json(TEMPLATES);
});

// Checks the rows (commit: false) or, when every row is right, saves them all (commit: true).
router.post('/import/:kind', async (req, res) => {
  const kind = parse(z.enum(IMPORT_KINDS), req.params.kind);
  const body = parse(z.object({ rows: z.array(z.record(z.string(), z.any())).max(3000), commit: z.boolean().default(false) }), req.body);
  const result = await importRows(kind, body.rows, { commit: body.commit, by: req.user.id });
  // The audit log keeps what was imported, not the whole file (which can hold passwords).
  req.skipAudit = true;
  if (result.saved) await audit(req.user, `import.${kind}`, null, null, { rows: result.total, summary: result.summary });
  res.status(result.saved ? 201 : 200).json(result);
});

// Every vehicle's sticker on one page to print (optionally one route's).
router.get('/vehicles/stickers', async (req, res) => {
  const { route_id } = parse(z.object({ route_id: id.optional() }), req.query);
  const rows = await db.all(
    `SELECT v.id, v.plate, v.car_number, r.name AS route_name FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id
     WHERE v.is_active = TRUE AND (CAST(? AS INTEGER) IS NULL OR v.route_id = ?) ORDER BY v.plate`,
    route_id ?? null,
    route_id ?? null,
  );
  res.json({ opens_with_camera: config.qrPrefix.startsWith('https://'), ussd_code: config.ussdCode, vehicles: rows });
});

// One message to many crew at once (e.g. "Thika Road closed, use Kenol").
router.get('/broadcast/count', async (req, res) => {
  const q = parse(z.object({ audience: z.enum(AUDIENCES), route_id: id.optional() }), req.query);
  res.json({ count: (await recipients(q.audience, q.route_id ?? null)).length });
});

router.post('/broadcast', async (req, res) => {
  const body = parse(
    z.object({ audience: z.enum(AUDIENCES), route_id: id.nullable().default(null), message: z.string().trim().min(3).max(300), sms: z.boolean().default(false) }),
    req.body,
  );
  res.status(201).json(await sendBroadcast({ audience: body.audience, routeId: body.route_id, message: body.message, sms: body.sms }, req.user));
});

// Reports for the accountant as CSV files that open in Excel (?from=&to= Kenyan dates, inclusive).
router.get('/exports', (_req, res) => {
  res.json(Object.entries(EXPORTS).map(([kind, title]) => ({ kind, title })));
});

router.get('/exports/:kind', async (req, res) => {
  const kind = parse(z.enum(Object.keys(EXPORTS)), req.params.kind);
  const q = parse(z.object({ from: z.string().date().default(nairobiToday), to: z.string().date().default(nairobiToday) }), req.query);
  const { name: fileName, text } = await exportReport(kind, q.from, q.to);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` }).send(text);
});

router.get('/search', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().max(60).default('') }), req.query);
  res.json(await searchEverything(q));
});

// A car's last 14 days: FarePay fares (verified) beside the cash its crew declared.
router.get('/vehicles/:id/cash', async (req, res) => {
  const vehicle = await getVehicle(parse(id, req.params.id));
  if (!vehicle) throw notFound('Vehicle');
  res.json(await cashAndFares(vehicle.id));
});

router.get('/vehicles/:id', async (req, res) => {
  const vehicle = await getVehicle(parse(id, req.params.id));
  if (!vehicle) throw notFound('Vehicle');
  res.json(vehicle);
});

// A vehicle belongs to an owner: chosen (owner_id), or given by name and phone (an owner with that phone gets this car
// added to theirs, keeping their own payment details; a new phone sets up a new owner with these details).
router.post('/vehicles', async (req, res) => {
  const body = parse(
    z.object({
      plate,
      description: optionalText.optional(),
      owner_id: id.optional(),
      owner_name: name.optional(),
      owner_phone: phone.optional(),
      ...payoutFields,
      seats: seatCount.optional(),
      conductor_id: id.nullable().optional(),
      driver_id: id.nullable().optional(),
      route_id: id.nullable().optional(),
    }),
    req.body,
  );
  if (await db.get('SELECT 1 FROM vehicles WHERE plate = ?', body.plate)) {
    throw new HttpError(409, 'PLATE_TAKEN', 'A vehicle with this number plate already exists');
  }
  if (!body.owner_id && !(body.owner_name && body.owner_phone)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Choose the owner, or give their name and phone number');
  }
  await checkVehicleLinks(body);
  const { vehicleId, existing } = await tx(async () => {
    let owner;
    let existed = true;
    if (body.owner_id) {
      owner = await getOwner(body.owner_id);
      if (!owner) throw notFound('Owner');
    } else {
      existed = Boolean(await db.get('SELECT 1 FROM owners WHERE phone = ?', body.owner_phone));
      if (!existed) checkPayoutDetails(body);
      owner = await findOrCreateOwner({
        name: body.owner_name,
        phone: body.owner_phone,
        payout_method: body.owner_payout_method ?? 'mpesa',
        bank_name: body.owner_bank_name ?? null,
        bank_paybill: body.owner_bank_paybill ?? null,
        bank_account: body.owner_bank_account ?? null,
      });
    }
    const newId = await db.insert(
      `INSERT INTO vehicles (plate, description, owner_name, owner_phone, seats, conductor_id, driver_id, route_id, qr_token, owner_id, car_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(car_number), 100) + 1 FROM vehicles))`,
      body.plate,
      body.description ?? null,
      owner.name,
      owner.phone,
      body.seats ?? 14,
      body.conductor_id ?? null,
      body.driver_id ?? null,
      body.route_id ?? null,
      newQrToken(),
      owner.id,
    );
    await linkVehicle(newId, owner.id);
    return { vehicleId: newId, existing: existed };
  });
  // owner_existing: the car was added to an owner who already had cars (their own payment details are used).
  res.status(201).json({ ...(await getVehicle(vehicleId)), owner_existing: existing });
});

// Owner details sent here (older app screens) change the owner, so all their cars; a different owner phone (or
// owner_id) moves the car to that owner.
router.patch('/vehicles/:id', async (req, res) => {
  const vehicleId = parse(id, req.params.id);
  const body = parse(
    z.object({
      description: optionalText.optional(),
      owner_id: id.optional(),
      owner_name: name.optional(),
      owner_phone: phone.optional(),
      ...payoutFields,
      seats: seatCount.optional(),
      conductor_id: id.nullable().optional(),
      driver_id: id.nullable().optional(),
      route_id: id.nullable().optional(),
      is_active: z.boolean().optional(),
    }),
    req.body,
  );
  const existing = await getVehicle(vehicleId);
  if (!existing) throw notFound('Vehicle');
  await checkVehicleLinks(body, vehicleId);
  const { owner_id, owner_name, owner_phone, owner_payout_method, owner_bank_name, owner_bank_paybill, owner_bank_account, ...vehicleFields } = body;
  await tx(async () => {
    if (owner_id && owner_id !== existing.owner_id) {
      if (!(await getOwner(owner_id))) throw notFound('Owner');
      await linkVehicle(vehicleId, owner_id);
    } else if (owner_phone && owner_phone !== existing.owner_phone) {
      const payout = { payout_method: owner_payout_method ?? 'mpesa', bank_name: owner_bank_name ?? null, bank_paybill: owner_bank_paybill ?? null, bank_account: owner_bank_account ?? null };
      if (!(await db.get('SELECT 1 FROM owners WHERE phone = ?', owner_phone))) checkPayoutDetails({ owner_payout_method: payout.payout_method, owner_bank_name: payout.bank_name, owner_bank_paybill: payout.bank_paybill, owner_bank_account: payout.bank_account });
      const owner = await findOrCreateOwner({ name: owner_name ?? existing.owner_name, phone: owner_phone, ...payout });
      await linkVehicle(vehicleId, owner.id);
    } else if (existing.owner_id && [owner_name, owner_payout_method, owner_bank_name, owner_bank_paybill, owner_bank_account].some((v) => v !== undefined)) {
      await updateOwner(existing.owner_id, {
        name: owner_name,
        payout_method: owner_payout_method,
        bank_name: owner_bank_name,
        bank_paybill: owner_bank_paybill,
        bank_account: owner_bank_account,
      });
    }
    if (Object.keys(vehicleFields).length) await updateRow('vehicles', vehicleId, vehicleFields);
  });
  res.json(await getVehicle(vehicleId));
});

// ---------- Vehicle owners ----------

const ownerFields = {
  name,
  phone,
  id_number: z.string().trim().max(30).transform((t) => t || null).nullable().optional(),
  payout_method: z.enum(['mpesa', 'bank']).default('mpesa'),
  bank_name: z.string().trim().max(60).transform((t) => t || null).nullable().optional(),
  bank_paybill: z.string().trim().regex(/^\d{5,7}$/, "The bank's M-Pesa paybill number (5 to 7 digits)").nullable().optional(),
  bank_account: z.string().trim().regex(/^[A-Za-z0-9-]{4,30}$/, 'Bank account number (letters, numbers or -)').nullable().optional(),
};

router.get('/owners', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().max(60).default('') }), req.query);
  res.json(await listOwners(q));
});

router.get('/owners/:id', async (req, res) => {
  res.json(await ownerDetail(parse(id, req.params.id)));
});

router.post('/owners', async (req, res) => {
  res.status(201).json(await createOwner(parse(z.object(ownerFields), req.body)));
});

// A change reaches all the owner's cars; a new phone number takes the fares not yet paid out with it.
router.patch('/owners/:id', async (req, res) => {
  const changes = parse(z.object(Object.fromEntries(Object.entries(ownerFields).map(([k, v]) => [k, v.optional()]))), req.body);
  res.json(await updateOwner(parse(id, req.params.id), changes));
});

// Makes the old sticker stop working (e.g. if it was copied onto another vehicle).
router.post('/vehicles/:id/rotate-qr', async (req, res) => {
  const vehicleId = parse(id, req.params.id);
  await updateRow('vehicles', vehicleId, { qr_token: newQrToken() });
  res.json(await getVehicle(vehicleId));
});

// ---------- Seat bookings: cars loading and trips ----------

// Every car that loaded on a day (default today, Kenyan time), plus cars loading and trips on the road now.
router.get('/trips', async (req, res) => {
  const { date } = parse(z.object({ date: z.string().date().default(nairobiToday) }), req.query);
  const [from, to] = nairobiDayRange(date);
  res.json({ date, ...(await officeTrips(from, to)) });
});

router.get('/trips/:id', async (req, res) => {
  res.json(await officeTrip(parse(id, req.params.id)));
});

// ---------- Parcels (fees are the SACCO's income, not fares) ----------

const mpesaCode = z.string().trim().regex(/^[A-Za-z0-9]{8,12}$/, 'The M-Pesa code (8 to 12 letters and numbers)');
const parcelPayment = z.discriminatedUnion('payment', [
  z.object({ payment: z.literal('prompt') }),
  z.object({ payment: z.literal('cash') }),
  z.object({ payment: z.literal('mpesa_code'), mpesa_code: mpesaCode }),
]);

router.get('/parcels', async (req, res) => {
  const q = parse(
    z.object({ status: z.enum(['awaiting_payment', 'received', 'on_the_way', 'arrived', 'collected', 'cancelled']).optional(), search: z.string().trim().max(60).optional() }),
    req.query,
  );
  res.json(await listParcels(q));
});

router.post('/parcels', async (req, res) => {
  const details = parse(
    z.object({
      sender_name: name,
      sender_phone: phone,
      receiver_name: name,
      receiver_phone: phone,
      route_id: id,
      stop_id: id,
      description: z.string().trim().max(200).transform((t) => t || null).optional(),
      fee: kes.max(100_000),
    }),
    req.body,
  );
  const payment = parse(parcelPayment, req.body);
  res.status(201).json(await createParcel({ ...details, ...payment }, req.user.id));
});

router.get('/parcels/:id', async (req, res) => {
  res.json(await refreshedParcel(parse(id, req.params.id)));
});

// Send the M-Pesa PIN prompt for the fee (again) to the sender's phone.
router.post('/parcels/:id/prompt', async (req, res) => {
  res.json(await sendParcelPrompt(parse(id, req.params.id)));
});

// The fee was paid in cash, or by M-Pesa another way (with its code).
router.post('/parcels/:id/payment', async (req, res) => {
  const body = parse(z.discriminatedUnion('method', [z.object({ method: z.literal('cash') }), z.object({ method: z.literal('mpesa_code'), mpesa_code: mpesaCode })]), req.body);
  res.json(await recordPayment(parse(id, req.params.id), { method: body.method, reference: body.mpesa_code }));
});

router.post('/parcels/:id/cancel', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(await cancelParcel(parse(id, req.params.id), reason));
});

// Handed to the receiver at the office, who showed the collection code.
router.post('/parcels/:id/collect', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The 6-digit collection code') }), req.body);
  res.json(await collectParcel(parse(id, req.params.id), code, req.user.id));
});

// The QR sticker to print and put inside the vehicle.
const qrPng = (vehicle) => QRCode.toBuffer(`${config.qrPrefix}${vehicle.qr_token}`, { width: 800, margin: 2, errorCorrectionLevel: 'M' });
const qrFileName = (vehicle) => `FarePay-QR-${vehicle.plate.replace(/\W+/g, '_')}.png`;

router.get('/vehicles/:id/qr.png', async (req, res) => {
  const vehicle = await getVehicle(parse(id, req.params.id));
  if (!vehicle) throw notFound('Vehicle');
  res.type('png').set('Content-Disposition', `inline; filename="${qrFileName(vehicle)}"`).send(await qrPng(vehicle));
});

// The same picture inside a normal JSON answer, for the app (images that need a sign-in don't load reliably on Android).
router.get('/vehicles/:id/qr', async (req, res) => {
  const vehicle = await getVehicle(parse(id, req.params.id));
  if (!vehicle) throw notFound('Vehicle');
  res.json({
    plate: vehicle.plate,
    car_number: vehicle.car_number,
    ussd_code: config.ussdCode,
    file_name: qrFileName(vehicle),
    png_base64: (await qrPng(vehicle)).toString('base64'),
    // A link sticker opens the pay page from any phone camera; otherwise only the FarePay app can read it.
    opens_with_camera: config.qrPrefix.startsWith('https://'),
  });
});

export default router;
