// SACCO office: routes and fares, conductors and drivers, vehicles (with the owner's payout details) and QR stickers.
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { db, insertId } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import * as mpesa from '../services/mpesa.js';
import { completePayout, createPayout, failPayout, getPayout, owedByOwner, payEveryone } from '../services/payouts.js';
import { createRoute, getRoute, listRoutes, stopsSchema, updateRoute } from '../services/routes.js';
import { refundTrip, TRIP_SELECT } from '../services/trips.js';
import { createUser, resetPassword } from '../services/users.js';
import { nairobiDayRange, nairobiToday, newQrToken } from '../util.js';
import { id, name, parse, password, phone } from '../validate.js';

const router = Router();

/** UPDATE table SET <only the provided fields> WHERE id = ? (used for vehicles). Field names come from zod schemas, never from raw input. */
function updateRow(table, rowId, fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new HttpError(400, 'NOTHING_TO_UPDATE', 'Nothing to update');
  const values = entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v));
  const result = db.prepare(`UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...values, rowId);
  if (result.changes === 0) throw notFound('Vehicle');
}

// ---------- Home dashboard ----------

router.get('/summary', (_req, res) => {
  const count = (sql) => db.prepare(sql).get().n;
  const [from, to] = nairobiDayRange(nairobiToday());
  res.json({
    routes: count('SELECT COUNT(*) AS n FROM routes WHERE is_active = 1'),
    vehicles: count('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = 1'),
    vehicles_without_route: count('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = 1 AND route_id IS NULL'),
    conductors: count("SELECT COUNT(*) AS n FROM users WHERE role = 'conductor' AND is_active = 1"),
    drivers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'driver' AND is_active = 1"),
    passengers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'passenger'"),
    today: daySummary(from, to),
    owed_to_owners: owedByOwner().reduce((sum, o) => sum + o.amount, 0),
  });
});

// ---------- Payments ----------

function daySummary(from, to) {
  return {
    ...db.prepare("SELECT COUNT(*) AS payments, COALESCE(SUM(fare), 0) AS total FROM trips WHERE status = 'paid' AND created_at >= ? AND created_at < ?").get(from, to),
    by_vehicle: db
      .prepare(
        `SELECT v.id, v.plate, v.owner_name, COUNT(*) AS payments, SUM(t.fare) AS total
         FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
         WHERE t.status = 'paid' AND t.created_at >= ? AND t.created_at < ? GROUP BY v.id ORDER BY total DESC`,
      )
      .all(from, to),
  };
}

// Every payment on one day (default today, Kenyan time), optionally for one vehicle.
router.get('/payments', (req, res) => {
  const { date, vehicle_id } = parse(z.object({ date: z.string().date().default(nairobiToday), vehicle_id: id.optional() }), req.query);
  const [from, to] = nairobiDayRange(date);
  const payments = db
    .prepare(`${TRIP_SELECT} WHERE t.created_at >= ? AND t.created_at < ? AND (? IS NULL OR t.vehicle_id = ?) ORDER BY t.id DESC LIMIT 500`)
    .all(from, to, vehicle_id ?? null, vehicle_id ?? null);
  res.json({ date, summary: daySummary(from, to), payments });
});

// Refund a fare to the passenger's wallet (vehicle broke down, wrong charge...).
router.post('/payments/:id/refund', (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(refundTrip(parse(id, req.params.id), reason));
});

// ---------- Owner payouts ----------

router.get('/payouts/owed', (_req, res) => {
  res.json({ owners: owedByOwner(), automatic: mpesa.isConfigured.b2c, daily_at: config.payoutDailyAt });
});

router.get('/payouts', (_req, res) => {
  res.json(db.prepare('SELECT * FROM payouts ORDER BY id DESC LIMIT 200').all());
});

router.get('/payouts/:id', (req, res) => {
  const payout = getPayout(parse(id, req.params.id));
  if (!payout) throw notFound('Payout');
  const trips = db.prepare(`${TRIP_SELECT} WHERE t.payout_id = ? ORDER BY t.id`).all(payout.id);
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
router.post('/payouts/:id/complete', (req, res) => {
  const { reference } = parse(z.object({ reference: z.string().trim().min(3).max(100) }), req.body);
  res.json(completePayout(parse(id, req.params.id), reference));
});

// The money did not reach the owner: the fares go back to "owed".
router.post('/payouts/:id/fail', (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(failPayout(parse(id, req.params.id), reason));
});

// ---------- Routes & fares ----------

// A route has a name, a starting point, and drop-off stops along the way, each with its own fares.

router.get('/routes', (_req, res) => {
  res.json(listRoutes());
});

router.get('/routes/:id', (req, res) => {
  const route = getRoute(parse(id, req.params.id));
  if (!route) throw notFound('Route');
  res.json(route);
});

router.post('/routes', (req, res) => {
  const body = parse(z.object({ name, origin: name, stops: stopsSchema }), req.body);
  res.status(201).json(getRoute(createRoute(body)));
});

// Send `stops` to replace the list of stops (in order): stops with an id are updated, new ones added,
// and stops left out are switched off.
router.patch('/routes/:id', (req, res) => {
  const routeId = parse(id, req.params.id);
  const body = parse(
    z.object({ name: name.optional(), origin: name.optional(), is_active: z.boolean().optional(), stops: stopsSchema.optional() }),
    req.body,
  );
  updateRoute(routeId, body);
  res.json(getRoute(routeId));
});

// ---------- Vehicle crew: conductors and drivers ----------
// Both work the same way: the office creates their sign-in, puts them on one vehicle, and can switch them off.

const CREW = {
  conductor: { path: 'conductors', column: 'conductor_id', label: 'Conductor' },
  driver: { path: 'drivers', column: 'driver_id', label: 'Driver' },
};

for (const [role, { path, column, label }] of Object.entries(CREW)) {
  const SELECT = `
    SELECT u.id, u.name, u.phone, u.is_active, u.created_at, v.id AS vehicle_id, v.plate AS vehicle_plate
    FROM users u LEFT JOIN vehicles v ON v.${column} = u.id
    WHERE u.role = '${role}'`;

  router.get(`/${path}`, (_req, res) => {
    res.json(db.prepare(`${SELECT} ORDER BY u.is_active DESC, u.name`).all());
  });

  router.post(`/${path}`, async (req, res) => {
    const body = parse(z.object({ name, phone, password }), req.body);
    const user = await createUser({ ...body, role });
    res.status(201).json(db.prepare(`${SELECT} AND u.id = ?`).get(user.id));
  });

  // Switching someone off signs them out and frees their vehicle for someone else.
  router.patch(`/${path}/:id`, (req, res) => {
    const userId = parse(id, req.params.id);
    const body = parse(z.object({ name: name.optional(), is_active: z.boolean().optional() }), req.body);
    const result = db
      .prepare('UPDATE users SET name = COALESCE(?, name), is_active = COALESCE(?, is_active) WHERE id = ? AND role = ?')
      .run(body.name ?? null, body.is_active === undefined ? null : Number(body.is_active), userId, role);
    if (result.changes === 0) throw notFound(label);
    if (body.is_active === false) db.prepare(`UPDATE vehicles SET ${column} = NULL WHERE ${column} = ?`).run(userId);
    res.json(db.prepare(`${SELECT} AND u.id = ?`).get(userId));
  });
}

// ---------- SACCO office staff ----------

router.get('/staff', (_req, res) => {
  res.json(db.prepare("SELECT id, name, phone, is_active, created_at FROM users WHERE role = 'admin' ORDER BY is_active DESC, name").all());
});

router.post('/staff', async (req, res) => {
  const body = parse(z.object({ name, phone, password }), req.body);
  const user = await createUser({ ...body, role: 'admin' });
  res.status(201).json(user);
});

// Switch a staff account off or on. Nobody can switch off their own account (so the office is never locked out).
router.patch('/staff/:id', (req, res) => {
  const staffId = parse(id, req.params.id);
  const { is_active } = parse(z.object({ is_active: z.boolean() }), req.body);
  if (staffId === req.user.id && !is_active) throw new HttpError(400, 'CANNOT_DISABLE_SELF', 'You cannot switch off your own account');
  const result = db.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role = 'admin'").run(Number(is_active), staffId);
  if (result.changes === 0) throw notFound('Staff account');
  res.json(db.prepare('SELECT id, name, phone, is_active, created_at FROM users WHERE id = ?').get(staffId));
});

// ---------- Passengers & passwords ----------

// Passengers, newest first; `q` searches by name or phone number.
router.get('/passengers', (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(50).optional() }), req.query);
  const digits = q?.replace(/\D/g, '').replace(/^0/, '') ?? '';
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.phone, u.is_active, u.created_at, w.balance AS wallet_balance,
              (SELECT COUNT(*) FROM trips t WHERE t.passenger_id = u.id) AS trips
       FROM users u LEFT JOIN wallets w ON w.user_id = u.id
       WHERE u.role = 'passenger' AND (? = '' OR u.name LIKE ? OR (? != '' AND u.phone LIKE ?))
       ORDER BY u.id DESC LIMIT 100`,
    )
    .all(q ?? '', `%${q ?? ''}%`, digits, `%${digits}%`);
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

const getVehicle = (vehicleId) => db.prepare(`${VEHICLE_SELECT} WHERE v.id = ?`).get(vehicleId);

const plate = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .transform((p) => p.toUpperCase().replace(/\s+/g, ' '));
const optionalText = z.string().trim().max(100).transform((t) => t || null);

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
function checkVehicleLinks(fields, vehicleId = null) {
  if (fields.route_id != null && !getRoute(fields.route_id)) throw notFound('Route');
  for (const [role, { column, label }] of Object.entries(CREW)) {
    const userId = fields[column];
    if (userId == null) continue;
    const person = db.prepare('SELECT is_active FROM users WHERE id = ? AND role = ?').get(userId, role);
    if (!person) throw new HttpError(400, `NOT_A_${role.toUpperCase()}`, `Choose a ${role} account`);
    if (!person.is_active) throw new HttpError(400, `${role.toUpperCase()}_DISABLED`, `This ${role} account is switched off`);
    const other = db.prepare(`SELECT plate FROM vehicles WHERE ${column} = ? AND id IS NOT ?`).get(userId, vehicleId);
    if (other) throw new HttpError(409, `${role.toUpperCase()}_TAKEN`, `This ${label.toLowerCase()} already works on ${other.plate}`);
  }
}

router.get('/vehicles', (_req, res) => {
  res.json(db.prepare(`${VEHICLE_SELECT} ORDER BY v.is_active DESC, v.plate`).all());
});

router.get('/vehicles/:id', (req, res) => {
  const vehicle = getVehicle(parse(id, req.params.id));
  if (!vehicle) throw notFound('Vehicle');
  res.json(vehicle);
});

router.post('/vehicles', (req, res) => {
  const body = parse(
    z.object({
      plate,
      description: optionalText.optional(),
      owner_name: name,
      owner_phone: phone,
      ...payoutFields,
      conductor_id: id.nullable().optional(),
      driver_id: id.nullable().optional(),
      route_id: id.nullable().optional(),
    }),
    req.body,
  );
  if (db.prepare('SELECT 1 FROM vehicles WHERE plate = ?').get(body.plate)) {
    throw new HttpError(409, 'PLATE_TAKEN', 'A vehicle with this number plate already exists');
  }
  checkPayoutDetails(body);
  checkVehicleLinks(body);
  const bank = body.owner_payout_method === 'bank';
  const vehicleId = insertId(
    db
      .prepare(
        `INSERT INTO vehicles (plate, description, owner_name, owner_phone, owner_payout_method, owner_bank_name, owner_bank_paybill,
                               owner_bank_account, conductor_id, driver_id, route_id, qr_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.plate,
        body.description ?? null,
        body.owner_name,
        body.owner_phone,
        bank ? 'bank' : 'mpesa',
        bank ? body.owner_bank_name : null,
        bank ? body.owner_bank_paybill : null,
        bank ? body.owner_bank_account : null,
        body.conductor_id ?? null,
        body.driver_id ?? null,
        body.route_id ?? null,
        newQrToken(),
      ),
  );
  res.status(201).json(getVehicle(vehicleId));
});

router.patch('/vehicles/:id', (req, res) => {
  const vehicleId = parse(id, req.params.id);
  const body = parse(
    z.object({
      description: optionalText.optional(),
      owner_name: name.optional(),
      owner_phone: phone.optional(),
      ...payoutFields,
      conductor_id: id.nullable().optional(),
      driver_id: id.nullable().optional(),
      route_id: id.nullable().optional(),
      is_active: z.boolean().optional(),
    }),
    req.body,
  );
  const existing = getVehicle(vehicleId);
  if (!existing) throw notFound('Vehicle');
  checkPayoutDetails({ ...existing, ...body });
  checkVehicleLinks(body, vehicleId);
  updateRow('vehicles', vehicleId, body);
  res.json(getVehicle(vehicleId));
});

// Makes the old sticker stop working (e.g. if it was copied onto another vehicle).
router.post('/vehicles/:id/rotate-qr', (req, res) => {
  const vehicleId = parse(id, req.params.id);
  updateRow('vehicles', vehicleId, { qr_token: newQrToken() });
  res.json(getVehicle(vehicleId));
});

// The QR sticker to print and put inside the vehicle.
router.get('/vehicles/:id/qr.png', async (req, res) => {
  const vehicle = getVehicle(parse(id, req.params.id));
  if (!vehicle) throw notFound('Vehicle');
  const png = await QRCode.toBuffer(`${config.qrPrefix}${vehicle.qr_token}`, { width: 800, margin: 2, errorCorrectionLevel: 'M' });
  res.type('png').set('Content-Disposition', `inline; filename="${vehicle.plate.replace(/\W+/g, '_')}.png"`).send(png);
});

export default router;
