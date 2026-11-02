// Vehicle owners: set up once, with how they are paid; one owner can have many cars. Each evening's payout adds up
// the fares of all their cars into one payment. The owner's name, phone and payout details are kept copied onto
// their vehicles (older screens and each fare's record read them there); a change here reaches all their cars, and
// fares not yet paid out follow the owner to a new phone number.
import { db, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { nairobiDayRange, nairobiToday } from '../util.js';

const OWNER_SELECT = `
  SELECT o.*, (SELECT COUNT(*) FROM vehicles v WHERE v.owner_id = o.id) AS vehicle_count
  FROM owners o`;

export const getOwner = (ownerId) => db.get(`${OWNER_SELECT} WHERE o.id = ?`, ownerId);
export const ownerByPhone = (phone) => db.get(`${OWNER_SELECT} WHERE o.phone = ?`, phone);

/** A bank owner needs the bank name, its paybill and their account number. */
export function checkOwnerPayout(o) {
  if (o.payout_method !== 'bank') return;
  const missing = ['bank_name', 'bank_paybill', 'bank_account'].filter((f) => !o[f]);
  if (missing.length) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', missing.map((field) => ({ field, message: 'Required for bank payouts' })));
  }
}

/** Copies the owner's details onto all their vehicles. Inside tx(). */
async function syncVehicles(ownerId) {
  const o = await db.get('SELECT * FROM owners WHERE id = ?', ownerId);
  const bank = o.payout_method === 'bank';
  await db.run(
    `UPDATE vehicles SET owner_name = ?, owner_phone = ?, owner_payout_method = ?, owner_bank_name = ?, owner_bank_paybill = ?, owner_bank_account = ?
     WHERE owner_id = ?`,
    o.name,
    o.phone,
    o.payout_method,
    bank ? o.bank_name : null,
    bank ? o.bank_paybill : null,
    bank ? o.bank_account : null,
    ownerId,
  );
}

export async function createOwner(fields) {
  checkOwnerPayout(fields);
  return tx(async () => {
    if (await ownerByPhone(fields.phone)) throw new HttpError(409, 'OWNER_EXISTS', 'An owner with this phone number already exists');
    const bank = fields.payout_method === 'bank';
    const ownerId = await db.insert(
      'INSERT INTO owners (name, phone, id_number, payout_method, bank_name, bank_paybill, bank_account) VALUES (?, ?, ?, ?, ?, ?, ?)',
      fields.name,
      fields.phone,
      fields.id_number ?? null,
      bank ? 'bank' : 'mpesa',
      bank ? fields.bank_name : null,
      bank ? fields.bank_paybill : null,
      bank ? fields.bank_account : null,
    );
    return getOwner(ownerId);
  });
}

/**
 * The owner with this phone number, set up from these details if there is none yet (adding a vehicle the old way,
 * or from a spreadsheet). An existing owner keeps their own details. Inside or outside tx().
 */
export async function findOrCreateOwner({ name, phone, payout_method = 'mpesa', bank_name = null, bank_paybill = null, bank_account = null }) {
  const existing = await ownerByPhone(phone);
  if (existing) return existing;
  return createOwner({ name, phone, payout_method, bank_name, bank_paybill, bank_account });
}

/**
 * Changes an owner's details; all their vehicles follow. A new phone number also moves the fares not yet paid out
 * (and refunds still to take back) to it, so nothing owed is left behind.
 */
export async function updateOwner(ownerId, changes) {
  return tx(async () => {
    const o = await db.get('SELECT * FROM owners WHERE id = ?', ownerId);
    if (!o) throw notFound('Owner');
    const next = { ...o, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) };
    checkOwnerPayout(next);
    if (next.phone !== o.phone && (await ownerByPhone(next.phone))) throw new HttpError(409, 'OWNER_EXISTS', 'Another owner already has this phone number');
    const bank = next.payout_method === 'bank';
    await db.run(
      'UPDATE owners SET name = ?, phone = ?, id_number = ?, payout_method = ?, bank_name = ?, bank_paybill = ?, bank_account = ? WHERE id = ?',
      next.name,
      next.phone,
      next.id_number ?? null,
      bank ? 'bank' : 'mpesa',
      bank ? next.bank_name : null,
      bank ? next.bank_paybill : null,
      bank ? next.bank_account : null,
      ownerId,
    );
    if (next.phone !== o.phone) {
      await db.run('UPDATE trips SET owner_phone = ?, owner_name = ? WHERE owner_phone = ? AND payout_id IS NULL', next.phone, next.name, o.phone);
      await db.run('UPDATE owner_deductions SET owner_phone = ? WHERE owner_phone = ? AND payout_id IS NULL', next.phone, o.phone);
    }
    await syncVehicles(ownerId);
    return getOwner(ownerId);
  });
}

/** Puts a vehicle under an owner (copying the owner's details onto it). Inside tx(). */
export async function linkVehicle(vehicleId, ownerId) {
  await db.run('UPDATE vehicles SET owner_id = ? WHERE id = ?', ownerId, vehicleId);
  await syncVehicles(ownerId);
}

/** Owners, by name (optionally searched by name or phone), each with their cars, what they are owed and today's takings. */
export async function listOwners(q = '') {
  const [from, to] = nairobiDayRange(nairobiToday());
  const like = `%${q.trim().toLowerCase()}%`;
  const digits = q.replace(/\D/g, '').replace(/^0/, '');
  return db.all(
    `SELECT o.id, o.name, o.phone, o.payout_method, o.bank_name,
            (SELECT COUNT(*) FROM vehicles v WHERE v.owner_id = o.id) AS vehicle_count,
            (SELECT COALESCE(SUM(t.fare), 0) FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
              WHERE v.owner_id = o.id AND t.status = 'paid' AND t.created_at >= ? AND t.created_at < ?) AS today_total,
            (SELECT COALESCE(SUM(t.fare), 0) FROM trips t WHERE t.owner_phone = o.phone AND t.status = 'paid' AND t.payout_id IS NULL)
              - (SELECT COALESCE(SUM(d.amount), 0) FROM owner_deductions d WHERE d.owner_phone = o.phone AND d.payout_id IS NULL) AS owed
     FROM owners o
     WHERE (CAST(? AS TEXT) = '' OR LOWER(o.name) LIKE ? OR (CAST(? AS TEXT) <> '' AND o.phone LIKE ?))
     ORDER BY o.name LIMIT 500`,
    from,
    to,
    q.trim(),
    like,
    digits.length >= 3 ? digits : '',
    `%${digits}%`,
  );
}

/** One owner: their details, each of their cars with today's takings and what is still to be paid, and their payouts. */
export async function ownerDetail(ownerId) {
  const owner = await getOwner(ownerId);
  if (!owner) throw notFound('Owner');
  const [from, to] = nairobiDayRange(nairobiToday());
  const vehicles = await db.all(
    `SELECT v.id, v.plate, v.is_active, r.name AS route_name,
            (SELECT COUNT(*) FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'paid' AND t.created_at >= ? AND t.created_at < ?) AS today_payments,
            (SELECT COALESCE(SUM(t.fare), 0) FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'paid' AND t.created_at >= ? AND t.created_at < ?) AS today_total,
            (SELECT COALESCE(SUM(t.fare), 0) FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'paid' AND t.payout_id IS NULL) AS unpaid
     FROM vehicles v LEFT JOIN routes r ON r.id = v.route_id WHERE v.owner_id = ? ORDER BY v.plate`,
    from,
    to,
    from,
    to,
    ownerId,
  );
  const deducted = (await db.get('SELECT COALESCE(SUM(amount), 0) AS n FROM owner_deductions WHERE owner_phone = ? AND payout_id IS NULL', owner.phone)).n;
  const payouts = await db.all(
    'SELECT id, amount, trip_count, status, method, reference, created_at, completed_at FROM payouts WHERE owner_id = ? OR owner_phone = ? ORDER BY id DESC LIMIT 30',
    ownerId,
    owner.phone,
  );
  // What the next payout will be: every unpaid fare under this owner's phone (also from cars they no longer own).
  const unpaid = (await db.get("SELECT COALESCE(SUM(fare), 0) AS n FROM trips WHERE owner_phone = ? AND status = 'paid' AND payout_id IS NULL", owner.phone)).n;
  return { owner, vehicles, owed: unpaid - deducted, refunds_to_take_back: deducted, payouts };
}
