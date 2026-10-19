// Step 3: the PostgreSQL layout (migrations/) has every table and every money-safety rule of the SQLite one.
// Runs only against TEST_DATABASE_URL (yarn test:pg), which it empties first. The app still runs on SQLite.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createPool, migrate } from '../src/postgres.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is not set (backend/.env)');
// Never empty anything but a test database.
if (!/\/[\w-]*_test(\?.*)?$/.test(url)) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');

const pool = createPool(url);
const q = (sql, params) => pool.query(sql, params);
/** Runs a statement that must be refused, and returns PostgreSQL's error. */
const refused = async (sql, params) => {
  await assert.rejects(q(sql, params), (err) => err instanceof Error);
  return q(sql, params).catch((err) => err);
};

const TABLES = [
  'audit_log', 'bookings', 'fare_changes', 'job_runs', 'load_stops', 'loads', 'mpesa_payments', 'notifications', 'owner_deductions', 'owners', 'parcel_payments', 'parcels', 'password_resets', 'payouts', 'push_tokens', 'report_messages', 'report_photos', 'reports',
  'route_stops', 'routes', 'saved_stops', 'seat_bookings', 'signup_codes', 'sms_outbox', 'trips', 'users', 'vehicle_locations', 'vehicles', 'wallet_transactions', 'wallets', 'withdrawals',
];

before(async () => {
  await q('DROP SCHEMA public CASCADE');
  await q('CREATE SCHEMA public');
});
after(() => pool.end());

const MIGRATIONS = ['001_initial_schema.sql', '002_seat_booking.sql', '003_arrival_updates.sql', '004_parcels.sql', '005_wallet_bookings.sql', '006_sms_push_reset.sql', '007_report_messages.sql', '008_report_seen.sql', '009_report_photos.sql', '010_seat_queue.sql', '011_vehicle_locations.sql', '012_free_rides.sql', '013_owners.sql', '014_car_numbers_ussd.sql', '015_signup_codes.sql'];

test('the migrations apply once; running them again changes nothing', async () => {
  assert.deepEqual(await migrate(pool), MIGRATIONS);
  assert.deepEqual(await migrate(pool), []);
  const { rows } = await q('SELECT name FROM schema_migrations');
  assert.deepEqual(rows.map((r) => r.name).sort(), MIGRATIONS);
});

test('all 30 FarePay tables exist, with the same columns as SQLite', async () => {
  const { rows } = await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY 1");
  assert.deepEqual(rows.map((r) => r.table_name), TABLES);
  const cols = async (t) => (await q('SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY 1', [t])).rows.map((r) => r.column_name);
  assert.deepEqual(await cols('wallets'), ['balance', 'updated_at', 'user_id']);
  assert.deepEqual(await cols('users'), ['created_at', 'id', 'is_active', 'name', 'password_hash', 'phone', 'role', 'session_version']);
  assert.equal((await cols('trips')).length, 19);
  assert.equal((await cols('vehicles')).length, 18); // 15 + seats (seat booking) + owner_id + car_number (USSD)
  assert.equal((await cols('mpesa_payments')).length, 18); // + channel (USSD)
});

test('every table has exactly the columns of the SQLite database the app uses today', async () => {
  process.env.DB_PATH = ':memory:';
  const { db: sqlite } = await import('../src/db.js');
  for (const table of TABLES) {
    const fromSqlite = sqlite.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY name`).all().map((c) => c.name);
    const fromPostgres = (await q('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY 1', ['public', table])).rows.map((c) => c.column_name);
    assert.deepEqual(fromPostgres.sort(), fromSqlite.sort(), table);
  }
  const sqliteTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  assert.deepEqual(sqliteTables, TABLES, 'no table missing on either side');
});

test('types: whole-shilling integers, real timestamps, true/false, JSON', async () => {
  const type = async (t, c) => (await q('SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [t, c])).rows[0].data_type;
  assert.equal(await type('wallets', 'balance'), 'integer');
  assert.equal(await type('trips', 'fare'), 'integer');
  assert.equal(await type('trips', 'created_at'), 'timestamp with time zone');
  assert.equal(await type('users', 'is_active'), 'boolean');
  assert.equal(await type('audit_log', 'details'), 'jsonb');
});

let passengerId;
test('sample rows go in, and come back the way the app expects', async () => {
  passengerId = (await q("INSERT INTO users (name, phone, password_hash, role) VALUES ('Pat', '254722333444', 'x', 'passenger') RETURNING id")).rows[0].id;
  assert.equal(typeof passengerId, 'number');
  await q('INSERT INTO wallets (user_id, balance) VALUES ($1, 150)', [passengerId]);
  const { rows } = await q('SELECT count(*) AS n, sum(balance) AS total, max(updated_at) AS at FROM wallets');
  assert.deepEqual([rows[0].n, rows[0].total], [1, 150], 'counts and sums are numbers, not text');
  assert.ok(rows[0].at instanceof Date);
  assert.match(JSON.stringify(rows[0].at), /^"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"$/, 'same time format as before');
  const user = (await q('SELECT is_active, session_version FROM users WHERE id = $1', [passengerId])).rows[0];
  assert.deepEqual(user, { is_active: true, session_version: 0 });
});

test('money rules: no negative balance, member fare never above cash fare, known entry types only', async () => {
  assert.equal((await refused('UPDATE wallets SET balance = -1 WHERE user_id = $1', [passengerId])).code, '23514');
  const routeId = (await q("INSERT INTO routes (name, origin) VALUES ('Thika Road', 'Town') RETURNING id")).rows[0].id;
  assert.equal((await refused("INSERT INTO route_stops (route_id, name, cash_fare, app_fare) VALUES ($1, 'Juja', 70, 80)", [routeId])).code, '23514');
  assert.equal((await refused("INSERT INTO route_stops (route_id, name, cash_fare, app_fare) VALUES ($1, 'Juja', 0, 0)", [routeId])).code, '23514');
  assert.equal((await refused("INSERT INTO wallet_transactions (user_id, type, amount, balance_after) VALUES ($1, 'gift', 100, 100)", [passengerId])).code, '23514');
  assert.equal((await refused("INSERT INTO users (name, phone, password_hash, role) VALUES ('X', '254700000009', 'x', 'owner')")).code, '23514');
});

test('one M-Pesa receipt per payment; payments without a receipt yet are fine', async () => {
  const pay = (receipt) =>
    q("INSERT INTO mpesa_payments (user_id, phone, amount, purpose, status, mpesa_receipt) VALUES ($1, '254722333444', 100, 'wallet', 'completed', $2)", [passengerId, receipt]);
  await pay('RCPT0001');
  assert.equal((await pay('RCPT0001').catch((e) => e)).code, '23505');
  await pay(null);
  await pay(null);
});

test('one fare per payment confirmation, one conductor and one driver per vehicle', async () => {
  const crew = async (phone, role) => (await q("INSERT INTO users (name, phone, password_hash, role) VALUES ('Crew', $1, 'x', $2) RETURNING id", [phone, role])).rows[0].id;
  const [driver, conductor] = [await crew('254711000001', 'driver'), await crew('254711000002', 'conductor')];
  const routeId = (await q("INSERT INTO routes (name, origin) VALUES ('Mombasa Road', 'Town') RETURNING id")).rows[0].id;
  const vehicle = async (plate) =>
    q("INSERT INTO vehicles (plate, owner_name, owner_phone, qr_token, driver_id, conductor_id, route_id) VALUES ($1, 'Mary', '254744555666', $1 || '-qr', $2, $3, $4) RETURNING id", [plate, driver, conductor, routeId]);
  const vehicleId = (await vehicle('KDA 123A')).rows[0].id;
  assert.equal((await vehicle('KDB 222B').catch((e) => e)).code, '23505', 'the same crew on a second vehicle is refused');
  const trip = () =>
    q(
      "INSERT INTO trips (ticket_code, passenger_id, vehicle_id, route_id, owner_name, owner_phone, fare, cash_fare, idempotency_key) VALUES (md5(random()::text), $1, $2, $3, 'Mary', '254744555666', 50, 60, 'same-key')",
      [passengerId, vehicleId, routeId],
    );
  await trip();
  assert.equal((await trip().catch((e) => e)).code, '23505');
});

test('the audit log can be added to, but never changed, deleted or emptied', async () => {
  await q("INSERT INTO audit_log (actor_role, action, details) VALUES ('system', 'test.entry', $1)", [{ amount: 100 }]);
  const row = (await q('SELECT details FROM audit_log')).rows[0];
  assert.deepEqual(row.details, { amount: 100 });
  for (const sql of ["UPDATE audit_log SET action = 'edited'", 'DELETE FROM audit_log', 'TRUNCATE audit_log']) {
    assert.match((await refused(sql)).message, /audit log entries cannot be changed or deleted/, sql);
  }
  assert.equal((await q('SELECT count(*) AS n FROM audit_log')).rows[0].n, 1);
});

test('daily job dates must look like YYYY-MM-DD', async () => {
  await q("INSERT INTO job_runs (name, last_run) VALUES ('daily_payouts', '2026-10-11')");
  assert.equal((await refused("INSERT INTO job_runs (name, last_run) VALUES ('money_check', 'yesterday')")).code, '23514');
});

test('copying rows with their old ids (for the switch-over) works once the counter is moved on', async () => {
  await q("INSERT INTO users (id, name, phone, password_hash, role) VALUES (50, 'Office', '254700000001', 'x', 'admin')");
  await q("SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT max(id) FROM users))");
  const next = (await q("INSERT INTO users (name, phone, password_hash, role) VALUES ('New', '254700000002', 'x', 'passenger') RETURNING id")).rows[0].id;
  assert.equal(next, 51);
});

test('a migration edited after it was applied is refused', async () => {
  await q("UPDATE schema_migrations SET checksum = 'edited' WHERE name = '001_initial_schema.sql'");
  await assert.rejects(migrate(pool), /was changed after it was applied/);
});
