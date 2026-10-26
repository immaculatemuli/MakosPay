// Loading many routes, crew or vehicles at once from a spreadsheet (the office's Excel or CSV file, read into rows
// by the dashboard). Every row is checked first with the same rules as adding one by hand; the answer lists each
// row's problems. Nothing is saved unless the whole file is right (`commit`), and then all of it in one go.
import { randomInt } from 'node:crypto';
import { db, tx } from '../database.js';
import { HttpError } from '../errors.js';
import { newQrToken, normalizePhone } from '../util.js';
import { PASSWORD_RULE, passwordOk } from '../validate.js';
import { findOrCreateOwner, linkVehicle } from './owners.js';
import { createRoute } from './routes.js';
import { createUser } from './users.js';

export const IMPORT_KINDS = ['routes', 'crew', 'vehicles'];
export const MAX_ROWS = 3000;

// Column names people may use, all mapped to one key (lower case, spaces and signs as _).
const ALIASES = {
  routes: { route: 'route', route_name: 'route', starts_from: 'origin', origin: 'origin', from: 'origin', stage: 'origin', stop: 'stop', drop_off: 'stop', dropoff: 'stop', cash_fare: 'cash_fare', fare: 'cash_fare', app_fare: 'app_fare', farepay_fare: 'app_fare' },
  crew: { name: 'name', full_name: 'name', phone: 'phone', phone_number: 'phone', role: 'role', job: 'role', password: 'password' },
  vehicles: {
    plate: 'plate', number_plate: 'plate', registration: 'plate', seats: 'seats', route: 'route', description: 'description', notes: 'description',
    owner: 'owner_name', owner_name: 'owner_name', owner_phone: 'owner_phone', owner_m_pesa: 'owner_phone', paid_by: 'paid_by', payout: 'paid_by',
    bank_name: 'bank_name', bank: 'bank_name', bank_paybill: 'bank_paybill', paybill: 'bank_paybill', bank_account: 'bank_account', account: 'bank_account',
    driver_phone: 'driver_phone', driver: 'driver_phone', conductor_phone: 'conductor_phone', conductor: 'conductor_phone',
  },
};

/** The template's columns for each kind (what the dashboard's "download template" gives). */
export const TEMPLATES = {
  routes: ['Route', 'Starts from', 'Stop', 'Cash fare', 'App fare'],
  crew: ['Name', 'Phone', 'Role', 'Password'],
  vehicles: ['Plate', 'Seats', 'Route', 'Owner name', 'Owner phone', 'Paid by', 'Bank name', 'Bank paybill', 'Bank account', 'Driver phone', 'Conductor phone', 'Description'],
};

const keyOf = (header) =>
  String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** A spreadsheet row with its columns renamed to our keys, and every value as trimmed text. */
function normalise(kind, row) {
  const out = {};
  for (const [header, value] of Object.entries(row ?? {})) {
    const key = ALIASES[kind][keyOf(header)];
    if (key) out[key] = value === null || value === undefined ? '' : String(value).trim();
  }
  return out;
}

const whole = (text) => (/^\d+(\.0+)?$/.test(text.replace(/,/g, '')) ? Number(text.replace(/,/g, '')) : NaN);
const plateOf = (text) => text.toUpperCase().replace(/\s+/g, ' ').trim();
const ROLE = { driver: 'driver', dereva: 'driver', conductor: 'conductor', kondakta: 'conductor', marshal: 'marshal', stage_marshal: 'marshal', msimamizi: 'marshal' };
const tempPassword = () => `Makos-${randomInt(100000, 1000000)}`;

/**
 * Checks rows of one kind and (`commit`, only when every row is right) saves them. Returns each row's problems
 * (row numbers as in the spreadsheet: 2 = the first row under the headings) and, once saved, what was made.
 */
export async function importRows(kind, rawRows, { commit, by }) {
  if (!IMPORT_KINDS.includes(kind)) throw new HttpError(404, 'NOT_FOUND', 'Unknown import');
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new HttpError(400, 'NO_ROWS', 'The file has no rows under the headings.');
  if (rawRows.length > MAX_ROWS) throw new HttpError(400, 'TOO_MANY_ROWS', `At most ${MAX_ROWS} rows at once. Split the file.`);
  const rows = rawRows.map((r) => normalise(kind, r));
  if (rows.every((r) => Object.keys(r).length === 0)) {
    throw new HttpError(400, 'NO_COLUMNS', `No column names were recognised. Use the template's headings: ${TEMPLATES[kind].join(', ')}.`);
  }
  const check = { routes: checkRoutes, crew: checkCrew, vehicles: checkVehicles }[kind];
  const result = await check(rows);
  const problems = result.rows.filter((r) => r.errors.length);
  const out = { kind, total: rows.length, ok: problems.length === 0, rows: result.rows, summary: result.summary, saved: false };
  if (!commit || problems.length) return out;
  out.created = await tx(() => result.save(by));
  out.saved = true;
  return out;
}

// ---------- Routes: one row per stop, in order ----------

async function checkRoutes(rows) {
  const routes = new Map(); // lower-case name → { name, origin, stops: [], firstRow }
  const checked = rows.map((r, i) => {
    const errors = [];
    const line = i + 2;
    if (!r.route) errors.push('Route is empty');
    if (!r.stop) errors.push('Stop is empty');
    const cash = whole(r.cash_fare ?? '');
    const app = r.app_fare ? whole(r.app_fare) : cash;
    if (!(cash > 0)) errors.push('Cash fare must be a whole number of shillings');
    if (!(app > 0)) errors.push('App fare must be a whole number of shillings');
    if (cash > 0 && app > cash) errors.push('App fare cannot be more than the cash fare');
    if (r.route) {
      const key = r.route.toLowerCase();
      const route = routes.get(key) ?? { name: r.route, origin: r.origin ?? '', stops: [], firstRow: line };
      if (!route.origin && r.origin) route.origin = r.origin;
      if (r.origin && route.origin && r.origin.toLowerCase() !== route.origin.toLowerCase()) errors.push(`Starts from differs from row ${route.firstRow} (${route.origin})`);
      if (r.stop && route.stops.some((s) => s.name.toLowerCase() === r.stop.toLowerCase())) errors.push(`${r.stop} is already a stop on ${route.name}`);
      route.stops.push({ name: r.stop, cash_fare: cash, app_fare: app });
      routes.set(key, route);
    }
    return { row: line, label: [r.route, r.stop].filter(Boolean).join(' → '), errors };
  });
  for (const route of routes.values()) {
    const exists = await db.get('SELECT 1 FROM routes WHERE LOWER(name) = ?', route.name.toLowerCase());
    const first = checked.find((c) => c.row === route.firstRow);
    if (exists) first.errors.push(`A route called ${route.name} already exists (change its fares on its page)`);
    if (!route.origin) first.errors.push('Starts from is empty');
  }
  return {
    rows: checked,
    summary: `${routes.size} route${routes.size === 1 ? '' : 's'} with ${rows.length} stop${rows.length === 1 ? '' : 's'}`,
    save: async (by) => {
      const made = [];
      for (const route of routes.values()) {
        await createRoute({ name: route.name, origin: route.origin, stops: route.stops }, by);
        made.push({ route: route.name, stops: route.stops.length });
      }
      return made;
    },
  };
}

// ---------- Crew: drivers, conductors and stage marshals ----------

async function checkCrew(rows) {
  const seen = new Map();
  const people = [];
  const checked = [];
  for (const [i, r] of rows.entries()) {
    const errors = [];
    const line = i + 2;
    const phone = normalizePhone(r.phone ?? '');
    const role = ROLE[keyOf(r.role)];
    if (!r.name || r.name.length < 2) errors.push('Name is empty');
    if (!phone) errors.push('Phone must be a Kenyan mobile number, e.g. 0712345678');
    if (!role) errors.push('Role must be driver, conductor or marshal');
    if (r.password && !passwordOk(r.password)) errors.push(`${PASSWORD_RULE} (or leave it empty to make one)`);
    if (phone) {
      if (seen.has(phone)) errors.push(`Same phone as row ${seen.get(phone)}`);
      else seen.set(phone, line);
      if (await db.get('SELECT 1 FROM users WHERE phone = ?', phone)) errors.push('This phone number already has a FarePay account');
    }
    people.push({ name: r.name, phone, role, password: r.password || tempPassword(), madePassword: !r.password });
    checked.push({ row: line, label: `${r.name ?? ''} (${role ?? r.role ?? '?'})`, errors });
  }
  const count = (role) => people.filter((p) => p.role === role).length;
  return {
    rows: checked,
    summary: [['driver', 'driver'], ['conductor', 'conductor'], ['marshal', 'stage marshal']].map(([role, word]) => `${count(role)} ${word}${count(role) === 1 ? '' : 's'}`).join(', '),
    save: async () => {
      const made = [];
      for (const p of people) {
        await createUser({ name: p.name, phone: p.phone, password: p.password, role: p.role });
        // Passwords we made are shown once, so the office can give them out (people change them after signing in).
        made.push({ name: p.name, phone: `0${p.phone.slice(3)}`, role: p.role, password: p.madePassword ? p.password : '(from the file)' });
      }
      return made;
    },
  };
}

// ---------- Vehicles and their owners ----------

async function checkVehicles(rows) {
  const plates = new Map();
  // One owner (by phone) can have many cars: the first row (or their existing owner record) sets how they are paid.
  const owners = new Map();
  const drivers = new Map();
  const conductors = new Map();
  const vehicles = [];
  const checked = [];
  const routeByName = new Map((await db.all('SELECT id, name FROM routes WHERE is_active = TRUE')).map((r) => [r.name.toLowerCase(), r.id]));
  // A crew member given by phone: an active account of that role, not on another vehicle or another row.
  const crewMember = async (phoneText, role, column, used, line, errors) => {
    if (!phoneText) return null;
    const phone = normalizePhone(phoneText);
    if (!phone) return errors.push(`${role === 'driver' ? 'Driver' : 'Conductor'} phone is not a Kenyan mobile number`), null;
    const person = await db.get('SELECT id, is_active FROM users WHERE phone = ? AND role = ?', phone, role);
    if (!person) return errors.push(`No ${role} account with phone ${phoneText} (import crew first)`), null;
    if (!person.is_active) return errors.push(`The ${role} with phone ${phoneText} is switched off`), null;
    const busy = await db.get(`SELECT plate FROM vehicles WHERE ${column} = ?`, person.id);
    if (busy) errors.push(`That ${role} already works on ${busy.plate}`);
    if (used.has(person.id)) errors.push(`Same ${role} as row ${used.get(person.id)}`);
    else used.set(person.id, line);
    return person.id;
  };

  for (const [i, r] of rows.entries()) {
    const errors = [];
    const line = i + 2;
    const plate = plateOf(r.plate ?? '');
    if (plate.length < 3 || plate.length > 20) errors.push('Plate is missing or too long');
    else {
      if (plates.has(plate)) errors.push(`Same plate as row ${plates.get(plate)}`);
      else plates.set(plate, line);
      if (await db.get('SELECT 1 FROM vehicles WHERE plate = ?', plate)) errors.push('A vehicle with this plate already exists');
    }
    const seats = r.seats ? whole(r.seats) : 14;
    if (!(seats >= 1 && seats <= 80)) errors.push('Seats must be a whole number from 1 to 80');
    let routeId = null;
    if (r.route) {
      routeId = routeByName.get(r.route.toLowerCase()) ?? null;
      if (!routeId) errors.push(`No route called ${r.route} (import routes first)`);
    }
    if (!r.owner_name || r.owner_name.length < 2) errors.push('Owner name is empty');
    const ownerPhone = normalizePhone(r.owner_phone ?? '');
    if (!ownerPhone) errors.push('Owner phone must be a Kenyan mobile number (owners are paid on it by M-Pesa)');
    const bank = keyOf(r.paid_by) === 'bank';
    if (r.paid_by && !['bank', 'mpesa', 'm_pesa'].includes(keyOf(r.paid_by))) errors.push('Paid by must be M-Pesa or Bank');
    if (bank) {
      if (!r.bank_name) errors.push('Bank name is needed when paid by bank');
      if (!/^\d{5,7}$/.test(r.bank_paybill ?? '')) errors.push("Bank paybill must be the bank's 5 to 7 digit M-Pesa paybill");
      if (!/^[A-Za-z0-9-]{4,30}$/.test(r.bank_account ?? '')) errors.push('Bank account number is missing or has odd characters');
    }
    if (ownerPhone) {
      const payout = bank ? `bank ${r.bank_paybill ?? ''} ${r.bank_account ?? ''}` : 'mpesa';
      const saved = await db.get('SELECT name, payout_method, bank_paybill, bank_account FROM owners WHERE phone = ?', ownerPhone);
      const known = owners.get(ownerPhone);
      if (saved && r.paid_by) {
        const savedPayout = saved.payout_method === 'bank' ? `bank ${saved.bank_paybill} ${saved.bank_account}` : 'mpesa';
        if (savedPayout !== payout) errors.push(`${saved.name} is already set up to be paid by ${saved.payout_method === 'bank' ? 'bank' : 'M-Pesa'}: change it on their owner page, or leave Paid by empty`);
      } else if (known && r.paid_by && known.payout !== payout) {
        errors.push(`Different payment details for the same owner as row ${known.line}`);
      }
      if (!known) owners.set(ownerPhone, { line, payout });
    }
    const driverId = await crewMember(r.driver_phone, 'driver', 'driver_id', drivers, line, errors);
    const conductorId = await crewMember(r.conductor_phone, 'conductor', 'conductor_id', conductors, line, errors);
    vehicles.push({ plate, seats, routeId, description: r.description || null, ownerName: r.owner_name, ownerPhone, bank, r, driverId, conductorId });
    checked.push({ row: line, label: plate || '(no plate)', errors });
  }
  return {
    rows: checked,
    summary: `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} of ${owners.size} owner${owners.size === 1 ? '' : 's'}`,
    save: async () => {
      const made = [];
      for (const v of vehicles) {
        const owner = await findOrCreateOwner({
          name: v.ownerName,
          phone: v.ownerPhone,
          payout_method: v.bank ? 'bank' : 'mpesa',
          bank_name: v.bank ? v.r.bank_name : null,
          bank_paybill: v.bank ? v.r.bank_paybill : null,
          bank_account: v.bank ? v.r.bank_account : null,
        });
        const vehicleId = await db.insert(
          `INSERT INTO vehicles (plate, description, owner_name, owner_phone, seats, conductor_id, driver_id, route_id, qr_token, owner_id, car_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(car_number), 100) + 1 FROM vehicles))`,
          v.plate,
          v.description,
          owner.name,
          owner.phone,
          v.seats,
          v.conductorId,
          v.driverId,
          v.routeId,
          newQrToken(),
          owner.id,
        );
        await linkVehicle(vehicleId, owner.id);
        made.push({ plate: v.plate, owner: owner.name });
      }
      return made;
    },
  };
}
