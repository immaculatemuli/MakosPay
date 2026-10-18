import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// ISO-8601 UTC with milliseconds, same format as Date#toISOString(), so text comparison works.
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// The kinds of user. Only passengers sign up themselves. The SACCO office (admin) creates conductors and
// drivers; the platform admin (whoever runs FarePay itself) is above the SACCO office and is created from
// the computer. Vehicle owners don't log in: the admin records their payout details on the vehicle.
// Stage marshals manage the queue of booked passengers at a stage and put them on the cars that arrive.
export const ROLES = ['admin', 'passenger', 'conductor', 'driver', 'platform_admin', 'marshal'];

// Kinds of wallet entry. withdrawal: sent back to the passenger's M-Pesa; withdrawal_reversal: it couldn't be sent;
// booking_hold / booking_release: a paid seat booking's money, held until the passenger boards or it is cancelled.
const WALLET_TYPE_LIST = ['topup', 'fare', 'refund', 'test_credit', 'withdrawal', 'withdrawal_reversal', 'booking_hold', 'booking_release'];
const WALLET_TYPES = WALLET_TYPE_LIST.map((t) => `'${t}'`).join(', ');
const MPESA_PURPOSES = ['wallet', 'fare', 'seat'];

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (${ROLES.map((r) => `'${r}'`).join(', ')})),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (${NOW})
);

-- A route starts at its origin and has drop-off stops along the way.
CREATE TABLE IF NOT EXISTS routes (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  origin     TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

-- Each drop-off has its own fare. App users pay app_fare, never more than the cash fare. Whole shillings.
-- Stops are switched off (is_active = 0) rather than deleted, because past trips point to them.
CREATE TABLE IF NOT EXISTS route_stops (
  id         INTEGER PRIMARY KEY,
  route_id   INTEGER NOT NULL REFERENCES routes(id),
  name       TEXT NOT NULL,
  cash_fare  INTEGER NOT NULL CHECK (cash_fare > 0),
  app_fare   INTEGER NOT NULL CHECK (app_fare > 0),
  position   INTEGER NOT NULL DEFAULT 0,   -- order along the route
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (app_fare <= cash_fare)
);
CREATE INDEX IF NOT EXISTS idx_route_stops_route ON route_stops(route_id, position);

-- Owners don't use the app: their name and M-Pesa number are kept on the vehicle for payouts.
CREATE TABLE IF NOT EXISTS vehicles (
  id           INTEGER PRIMARY KEY,
  plate        TEXT NOT NULL UNIQUE,
  description  TEXT,
  owner_name   TEXT NOT NULL,
  owner_phone  TEXT NOT NULL,
  conductor_id INTEGER UNIQUE REFERENCES users(id),
  route_id     INTEGER REFERENCES routes(id),
  qr_token     TEXT NOT NULL UNIQUE,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (${NOW})
);

-- Each passenger's wallet. Every change is recorded in wallet_transactions with the balance after it.
CREATE TABLE IF NOT EXISTS wallets (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL CHECK (type IN (${WALLET_TYPES})),
  amount        INTEGER NOT NULL,          -- positive = money in, negative = money out
  balance_after INTEGER NOT NULL,
  reference     TEXT,                      -- ticket code, M-Pesa receipt...
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, id);

-- A paid fare. The owner's details are copied from the vehicle at the time, so the right person is paid.
CREATE TABLE IF NOT EXISTS trips (
  id              INTEGER PRIMARY KEY,
  ticket_code     TEXT NOT NULL UNIQUE,
  passenger_id    INTEGER NOT NULL REFERENCES users(id),
  vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id),
  route_id        INTEGER NOT NULL REFERENCES routes(id),
  conductor_id    INTEGER REFERENCES users(id),
  owner_name      TEXT NOT NULL,
  owner_phone     TEXT NOT NULL,
  fare            INTEGER NOT NULL,
  cash_fare       INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (passenger_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trips_passenger ON trips(passenger_id, id);

-- Every M-Pesa PIN prompt sent to a passenger: a wallet top-up ('wallet') or one fare paid directly ('fare').
-- Money is only credited once M-Pesa confirms.
CREATE TABLE IF NOT EXISTS mpesa_payments (
  id                  INTEGER PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  phone               TEXT NOT NULL,
  amount              INTEGER NOT NULL CHECK (amount > 0),
  purpose             TEXT NOT NULL CHECK (purpose IN (${MPESA_PURPOSES.map((x) => `'${x}'`).join(', ')})),
  status              TEXT NOT NULL CHECK (status IN ('initiating', 'pending', 'completed', 'failed')),
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  mpesa_receipt       TEXT,
  result_desc         TEXT,
  last_queried_at     TEXT,
  -- For fares: what was being paid for, as shown when the passenger confirmed.
  vehicle_id          INTEGER REFERENCES vehicles(id),
  stop_id             INTEGER REFERENCES route_stops(id),
  idempotency_key     TEXT,
  trip_id             INTEGER REFERENCES trips(id),
  created_at          TEXT NOT NULL DEFAULT (${NOW}),
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_mpesa_payments_status ON mpesa_payments(status);

-- Money sent to a vehicle owner's M-Pesa: all their fares not yet paid out. Owners are identified by
-- their M-Pesa number (copied onto each trip). If a payout fails, its trips become unpaid again.
CREATE TABLE IF NOT EXISTS payouts (
  id                 INTEGER PRIMARY KEY,
  owner_name         TEXT NOT NULL,
  owner_phone        TEXT NOT NULL,
  amount             INTEGER NOT NULL CHECK (amount > 0),
  trip_count         INTEGER NOT NULL,
  -- processing: sent to M-Pesa, waiting for the result. manual: the office sends the money itself.
  status             TEXT NOT NULL CHECK (status IN ('processing', 'manual', 'completed', 'failed')),
  conversation_id    TEXT NOT NULL UNIQUE,  -- our id for this payout at M-Pesa
  provider_reference TEXT,                  -- M-Pesa's / IntaSend's id for it
  reference          TEXT,                  -- M-Pesa transaction code once paid
  result_desc        TEXT,
  created_by         INTEGER REFERENCES users(id),  -- NULL = the automatic daily payout
  created_at         TEXT NOT NULL DEFAULT (${NOW}),
  completed_at       TEXT
);

-- A passenger taking wallet money back to their own M-Pesa number. The wallet is debited when it is asked
-- for; if the money can't be sent, it goes back into the wallet ('withdrawal_reversal').
CREATE TABLE IF NOT EXISTS withdrawals (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  phone              TEXT NOT NULL,
  amount             INTEGER NOT NULL CHECK (amount > 0),
  -- processing: sent to M-Pesa, waiting for the result. manual: the office sends the money itself.
  status             TEXT NOT NULL CHECK (status IN ('processing', 'manual', 'completed', 'failed')),
  conversation_id    TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  reference          TEXT,                  -- M-Pesa transaction code once sent
  result_desc        TEXT,
  handled_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (${NOW}),
  completed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- Last run of scheduled jobs, so a restart never runs the daily payout twice.
CREATE TABLE IF NOT EXISTS job_runs (
  name     TEXT PRIMARY KEY,
  last_run TEXT NOT NULL
);
`);

// The users table only allowed three roles at first: rebuild it once so it accepts all of ROLES (ids are kept).
const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().sql;
if (!usersSql.includes("'platform_admin'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  tx(() => {
    db.exec(`
      CREATE TABLE users_new (
        id            INTEGER PRIMARY KEY,
        name          TEXT NOT NULL,
        phone         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN (${ROLES.map((r) => `'${r}'`).join(', ')})),
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (${NOW})
      );
      INSERT INTO users_new SELECT id, name, phone, password_hash, role, is_active, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });
  db.exec('PRAGMA foreign_keys = ON');
}

// Wallet history only allowed four kinds of entry at first: rebuild it once to allow withdrawals (ids kept).
const walletTxSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'wallet_transactions'").get().sql;
if (!walletTxSql.includes("'withdrawal'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  tx(() => {
    db.exec(`
      CREATE TABLE wallet_transactions_new (
        id            INTEGER PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id),
        type          TEXT NOT NULL CHECK (type IN (${WALLET_TYPES})),
        amount        INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        reference     TEXT,
        description   TEXT,
        created_at    TEXT NOT NULL DEFAULT (${NOW})
      );
      INSERT INTO wallet_transactions_new SELECT id, user_id, type, amount, balance_after, reference, description, created_at FROM wallet_transactions;
      DROP TABLE wallet_transactions;
      ALTER TABLE wallet_transactions_new RENAME TO wallet_transactions;
      CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id, id);
    `);
  });
  db.exec('PRAGMA foreign_keys = ON');
}

// Passengers who signed up before wallets existed get an empty one.
db.exec("INSERT OR IGNORE INTO wallets (user_id) SELECT id FROM users WHERE role = 'passenger'");

const hasColumn = (table, column) => Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column));

// Routes used to have one destination and fare. Turn each into a route with one stop, then drop the old columns.
if (hasColumn('routes', 'cash_fare')) {
  db.exec('PRAGMA foreign_keys = OFF');
  tx(() => {
    db.exec(`
      INSERT INTO route_stops (route_id, name, cash_fare, app_fare, position)
        SELECT id, destination, cash_fare, app_fare, 1 FROM routes;
      CREATE TABLE routes_new (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        origin     TEXT NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (${NOW})
      );
      INSERT INTO routes_new SELECT id, name, origin, is_active, created_at FROM routes;
      DROP TABLE routes;
      ALTER TABLE routes_new RENAME TO routes;
    `);
  });
  db.exec('PRAGMA foreign_keys = ON');
}

// One M-Pesa receipt can only ever be recorded on one payment, so the same money can't be credited twice.
// (Only added if the data already obeys it, so an old duplicate never stops the server from starting.)
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_mpesa_payments_receipt'").get()) {
  const dupes = db.prepare('SELECT mpesa_receipt FROM mpesa_payments WHERE mpesa_receipt IS NOT NULL GROUP BY mpesa_receipt HAVING COUNT(*) > 1').all();
  if (dupes.length === 0) db.exec('CREATE UNIQUE INDEX idx_mpesa_payments_receipt ON mpesa_payments(mpesa_receipt) WHERE mpesa_receipt IS NOT NULL');
  else console.warn(`! M-Pesa receipts recorded more than once: ${dupes.map((d) => d.mpesa_receipt).join(', ')}. Check them in Money check.`);
}

// Raised when the password changes, so every older sign-in stops working (see auth.js).
if (!hasColumn('users', 'session_version')) db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');

// Trips now record which stop the passenger paid to.
if (!hasColumn('trips', 'stop_id')) db.exec('ALTER TABLE trips ADD COLUMN stop_id INTEGER REFERENCES route_stops(id)');
if (!hasColumn('trips', 'stop_name')) db.exec('ALTER TABLE trips ADD COLUMN stop_name TEXT');
// The payout that sent this fare to the owner (NULL = not paid out yet).
if (!hasColumn('trips', 'payout_id')) db.exec('ALTER TABLE trips ADD COLUMN payout_id INTEGER REFERENCES payouts(id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_trips_unpaid ON trips(owner_phone) WHERE payout_id IS NULL');

// Refunds: a refunded fare goes back to the passenger's wallet and is not paid to the owner.
if (!hasColumn('trips', 'status')) db.exec("ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded'))");
if (!hasColumn('trips', 'refunded_at')) db.exec('ALTER TABLE trips ADD COLUMN refunded_at TEXT');
if (!hasColumn('trips', 'refund_reason')) db.exec('ALTER TABLE trips ADD COLUMN refund_reason TEXT');
db.exec(`
-- A fare refunded after the owner was already paid it: taken off the owner's next payout.
CREATE TABLE IF NOT EXISTS owner_deductions (
  id          INTEGER PRIMARY KEY,
  owner_phone TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  trip_id     INTEGER NOT NULL REFERENCES trips(id),
  payout_id   INTEGER REFERENCES payouts(id),   -- the payout it was taken off (NULL = not yet)
  created_at  TEXT NOT NULL DEFAULT (${NOW})
);
`);

db.exec(`
-- Every fare change for a drop-off stop: what it was, what it became, who changed it and from when.
-- A change dated in the future waits (applied_at NULL) until that day. Past payments keep their own fares.
CREATE TABLE IF NOT EXISTS fare_changes (
  id             INTEGER PRIMARY KEY,
  stop_id        INTEGER NOT NULL REFERENCES route_stops(id),
  old_cash_fare  INTEGER NOT NULL,
  old_app_fare   INTEGER NOT NULL,
  new_cash_fare  INTEGER NOT NULL CHECK (new_cash_fare > 0),
  new_app_fare   INTEGER NOT NULL CHECK (new_app_fare > 0),
  effective_from TEXT NOT NULL,   -- when it takes effect (UTC), e.g. midnight Kenyan time on the chosen day
  applied_at     TEXT,            -- when it actually took effect (NULL = still waiting)
  cancelled_at   TEXT,
  reason         TEXT,
  changed_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (new_app_fare <= new_cash_fare)
);
CREATE INDEX IF NOT EXISTS idx_fare_changes_stop ON fare_changes(stop_id, id);
CREATE INDEX IF NOT EXISTS idx_fare_changes_due ON fare_changes(effective_from) WHERE applied_at IS NULL AND cancelled_at IS NULL;

-- What office and platform staff did, for accountability. Only ever added to: there is no way to edit or delete.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor_id   INTEGER REFERENCES users(id),   -- NULL = the system itself (e.g. the daily payout)
  actor_role TEXT,
  action     TEXT NOT NULL,                  -- e.g. 'fare.change', 'payment.refund', 'payout.complete'
  entity     TEXT,                           -- e.g. 'stop', 'trip', 'payout'
  entity_id  INTEGER,
  details    TEXT,                           -- JSON with the important values
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log entries cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log entries cannot be deleted'); END;

-- In-app notifications (the bell). target = what it is about, so the app can open the right screen.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  target     TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);

-- Drop-off stops a passenger saved for quick choosing.
CREATE TABLE IF NOT EXISTS saved_stops (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  stop_id    INTEGER NOT NULL REFERENCES route_stops(id),
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  PRIMARY KEY (user_id, stop_id)
);

-- Problems reported by passengers (and later crew): payment issues, wrong fare, charged twice...
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  category    TEXT NOT NULL CHECK (category IN ('payment_problem', 'wrong_fare', 'duplicate_charge', 'wrong_route', 'other')),
  trip_id     INTEGER REFERENCES trips(id),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  office_note TEXT,                              -- the SACCO office's answer, shown to the reporter
  handled_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (${NOW}),
  updated_at  TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, id);
`);

// Crew trip start/end was tried and removed: take its leftovers out of databases that had it.
if (hasColumn('trips', 'run_id')) db.exec('ALTER TABLE trips DROP COLUMN run_id');
db.exec('DROP TABLE IF EXISTS vehicle_runs');

// Each vehicle can have one driver (as well as one conductor).
if (!hasColumn('vehicles', 'driver_id')) {
  db.exec('ALTER TABLE vehicles ADD COLUMN driver_id INTEGER REFERENCES users(id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_driver ON vehicles(driver_id) WHERE driver_id IS NOT NULL');
}

// Owners can be paid to M-Pesa or to a bank account (through the bank's M-Pesa paybill).
if (!hasColumn('vehicles', 'owner_payout_method')) {
  db.exec("ALTER TABLE vehicles ADD COLUMN owner_payout_method TEXT NOT NULL DEFAULT 'mpesa' CHECK (owner_payout_method IN ('mpesa', 'bank'))");
}
for (const column of ['owner_bank_name', 'owner_bank_paybill', 'owner_bank_account']) {
  if (!hasColumn('vehicles', column)) db.exec(`ALTER TABLE vehicles ADD COLUMN ${column} TEXT`);
}
if (!hasColumn('payouts', 'method')) db.exec("ALTER TABLE payouts ADD COLUMN method TEXT NOT NULL DEFAULT 'mpesa' CHECK (method IN ('mpesa', 'bank'))");
for (const column of ['bank_name', 'bank_paybill', 'bank_account']) {
  if (!hasColumn('payouts', column)) db.exec(`ALTER TABLE payouts ADD COLUMN ${column} TEXT`);
}

// Seat booking (the same as migrations/002_seat_booking.sql for PostgreSQL).
if (!hasColumn('vehicles', 'seats')) db.exec('ALTER TABLE vehicles ADD COLUMN seats INTEGER NOT NULL DEFAULT 14 CHECK (seats BETWEEN 1 AND 80)');
db.exec(`
CREATE TABLE IF NOT EXISTS loads (
  id          INTEGER PRIMARY KEY,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  route_id    INTEGER NOT NULL REFERENCES routes(id),
  seats       INTEGER NOT NULL CHECK (seats > 0),
  status      TEXT NOT NULL DEFAULT 'loading' CHECK (status IN ('loading', 'departed')),
  started_by  INTEGER REFERENCES users(id),
  started_at  TEXT NOT NULL DEFAULT (${NOW}),
  departed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loads_one_loading_per_vehicle ON loads(vehicle_id) WHERE status = 'loading';
CREATE INDEX IF NOT EXISTS idx_loads_route_status ON loads(route_id, status, started_at);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  load_id          INTEGER NOT NULL REFERENCES loads(id),
  passenger_id     INTEGER NOT NULL REFERENCES users(id),
  stop_id          INTEGER NOT NULL REFERENCES route_stops(id),
  seats            INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 10),
  fare_each        INTEGER NOT NULL CHECK (fare_each > 0),
  amount           INTEGER NOT NULL CHECK (amount > 0),
  mpesa_payment_id INTEGER REFERENCES mpesa_payments(id),
  idempotency_key  TEXT NOT NULL,
  boarded_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (passenger_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_bookings_load ON bookings(load_id);
`);

// SMS, push notifications and "forgot password" (the same as migrations/006_sms_push_reset.sql).
db.exec(`
CREATE TABLE IF NOT EXISTS sms_outbox (
  id                  INTEGER PRIMARY KEY,
  phone               TEXT NOT NULL,
  kind                TEXT NOT NULL,
  message             TEXT,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'logged')),
  provider_message_id TEXT,
  error               TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (${NOW}),
  sent_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_sms_outbox_status ON sms_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS push_tokens (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  token        TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (${NOW}),
  last_seen_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at);
`);
if (!hasColumn('notifications', 'pushed_at')) db.exec('ALTER TABLE notifications ADD COLUMN pushed_at TEXT');

// Bookings paid from the wallet point straight at their fare (migrations/005_wallet_bookings.sql).
if (!hasColumn('bookings', 'trip_id')) db.exec('ALTER TABLE bookings ADD COLUMN trip_id INTEGER REFERENCES trips(id)');

// Arrival updates (the same as migrations/003_arrival_updates.sql for PostgreSQL).
if (!hasColumn('loads', 'finished_at')) db.exec('ALTER TABLE loads ADD COLUMN finished_at TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS load_stops (
  id         INTEGER PRIMARY KEY,
  load_id    INTEGER NOT NULL REFERENCES loads(id),
  stop_id    INTEGER NOT NULL REFERENCES route_stops(id),
  reached_at TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (load_id, stop_id)
);
CREATE INDEX IF NOT EXISTS idx_load_stops_stop ON load_stops(stop_id, reached_at);
`);

// Parcels (the same as migrations/004_parcels.sql for PostgreSQL).
db.exec(`
CREATE TABLE IF NOT EXISTS parcels (
  id                INTEGER PRIMARY KEY,
  tracking_code     TEXT NOT NULL UNIQUE,
  collection_code   TEXT NOT NULL,
  sender_name       TEXT NOT NULL,
  sender_phone      TEXT NOT NULL,
  receiver_name     TEXT NOT NULL,
  receiver_phone    TEXT NOT NULL,
  route_id          INTEGER NOT NULL REFERENCES routes(id),
  stop_id           INTEGER NOT NULL REFERENCES route_stops(id),
  description       TEXT,
  fee               INTEGER NOT NULL CHECK (fee > 0),
  status            TEXT NOT NULL DEFAULT 'awaiting_payment'
                    CHECK (status IN ('awaiting_payment', 'received', 'on_the_way', 'arrived', 'collected', 'cancelled')),
  payment_method    TEXT CHECK (payment_method IN ('mpesa_prompt', 'mpesa_code', 'cash')),
  payment_reference TEXT,
  paid_at           TEXT,
  vehicle_id        INTEGER REFERENCES vehicles(id),
  load_id           INTEGER REFERENCES loads(id),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  collected_by      INTEGER REFERENCES users(id),
  cancel_reason     TEXT,
  created_at        TEXT NOT NULL DEFAULT (${NOW}),
  loaded_at         TEXT,
  arrived_at        TEXT,
  collected_at      TEXT,
  cancelled_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_parcels_status_route ON parcels(status, route_id);
CREATE INDEX IF NOT EXISTS idx_parcels_vehicle ON parcels(vehicle_id, status);

CREATE TABLE IF NOT EXISTS parcel_payments (
  id                  INTEGER PRIMARY KEY,
  parcel_id           INTEGER NOT NULL REFERENCES parcels(id),
  phone               TEXT NOT NULL,
  amount              INTEGER NOT NULL CHECK (amount > 0),
  status              TEXT NOT NULL CHECK (status IN ('initiating', 'pending', 'completed', 'failed')),
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  mpesa_receipt       TEXT UNIQUE,
  result_desc         TEXT,
  last_queried_at     TEXT,
  created_at          TEXT NOT NULL DEFAULT (${NOW}),
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_parcel_payments_status ON parcel_payments(status);
`);

// Problem report conversations (the same as migrations/007_report_messages.sql for PostgreSQL).
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report_messages'").get()) {
  db.exec(`
CREATE TABLE report_messages (
  id          INTEGER PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES reports(id),
  sender_id   INTEGER REFERENCES users(id),
  from_office INTEGER NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX idx_report_messages_report ON report_messages(report_id, id);
INSERT INTO report_messages (report_id, sender_id, from_office, message, created_at)
SELECT id, handled_by, 1, office_note, updated_at FROM reports WHERE office_note IS NOT NULL;
`);
}

// When each side last looked at a report (the same as migrations/008_report_seen.sql for PostgreSQL).
if (!hasColumn('reports', 'office_seen_at')) {
  db.exec(`
ALTER TABLE reports ADD COLUMN reporter_seen_at TEXT;
ALTER TABLE reports ADD COLUMN office_seen_at TEXT;
UPDATE reports SET reporter_seen_at = ${NOW}, office_seen_at = ${NOW};
`);
}

// Photos on problem reports (the same as migrations/009_report_photos.sql for PostgreSQL).
db.exec(`
CREATE TABLE IF NOT EXISTS report_photos (
  id          INTEGER PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES reports(id),
  message_id  INTEGER REFERENCES report_messages(id),
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS idx_report_photos_report ON report_photos(report_id);
`);

/**
 * Lets a column's CHECK (x IN (...)) list accept more values: SQLite can't change a CHECK, so the table is rebuilt
 * from its own definition with the longer list (same columns, ids and data; its indexes and triggers made again).
 */
function widenCheck(table, oldList, newList) {
  const quote = (list) => list.map((v) => `'${v}'`).join(', ');
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
  if (!sql.includes(`(${quote(oldList)})`)) return; // already widened (or a new database)
  const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL").all(table);
  db.exec('PRAGMA foreign_keys = OFF');
  tx(() => {
    db.exec(sql.replace(`(${quote(oldList)})`, `(${quote(newList)})`).replace(/^CREATE TABLE "?\w+"?/, `CREATE TABLE ${table}_new`));
    db.exec(`INSERT INTO ${table}_new SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table};`);
    for (const e of extras) db.exec(e.sql);
  });
  db.exec('PRAGMA foreign_keys = ON');
}

// Seat booking from anywhere (the same as migrations/010_seat_queue.sql for PostgreSQL).
widenCheck('users', ROLES.slice(0, 5), ROLES);
widenCheck('wallet_transactions', WALLET_TYPE_LIST.slice(0, 6), WALLET_TYPE_LIST);
widenCheck('mpesa_payments', MPESA_PURPOSES.slice(0, 2), MPESA_PURPOSES);
db.exec(`
CREATE TABLE IF NOT EXISTS seat_bookings (
  id                 INTEGER PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  passenger_id       INTEGER NOT NULL REFERENCES users(id),
  route_id           INTEGER NOT NULL REFERENCES routes(id),
  pickup_stop_id     INTEGER REFERENCES route_stops(id),
  stop_id            INTEGER NOT NULL REFERENCES route_stops(id),
  seats              INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 10),
  fare_each          INTEGER NOT NULL CHECK (fare_each > 0),
  amount             INTEGER NOT NULL CHECK (amount > 0),
  pay_with           TEXT NOT NULL CHECK (pay_with IN ('mpesa', 'wallet')),
  mpesa_payment_id   INTEGER REFERENCES mpesa_payments(id),
  status             TEXT NOT NULL CHECK (status IN ('paying', 'queued', 'assigned', 'boarded', 'cancelled', 'failed')),
  queued_at          TEXT,
  load_id            INTEGER REFERENCES loads(id),
  assigned_at        TEXT,
  passenger_here_at  TEXT,
  boarded_at         TEXT,
  trip_id            INTEGER REFERENCES trips(id),
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  refund_to          TEXT CHECK (refund_to IN ('mpesa', 'wallet')),
  refund_withdrawal_id INTEGER REFERENCES withdrawals(id),
  idempotency_key    TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (passenger_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_seat_bookings_queue ON seat_bookings(route_id, status, queued_at, id);
CREATE INDEX IF NOT EXISTS idx_seat_bookings_load ON seat_bookings(load_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_bookings_payment ON seat_bookings(mpesa_payment_id) WHERE mpesa_payment_id IS NOT NULL;
`);

// Where each car is (the same as migrations/011_vehicle_locations.sql for PostgreSQL).
db.exec(`
CREATE TABLE IF NOT EXISTS vehicle_locations (
  vehicle_id  INTEGER PRIMARY KEY REFERENCES vehicles(id),
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading     REAL,
  speed       REAL,
  accuracy    REAL,
  recorded_at TEXT NOT NULL DEFAULT (${NOW})
);
`);

/**
 * Runs fn inside a write transaction. fn must be synchronous (no await inside),
 * which together with node:sqlite's synchronous API makes it atomic.
 */
export function tx(fn) {
  // Already inside a transaction (e.g. a payment applying a due fare change): just join it.
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const insertId = (result) => Number(result.lastInsertRowid);
