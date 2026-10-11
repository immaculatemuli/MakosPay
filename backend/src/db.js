import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

// ISO-8601 UTC with milliseconds, same format as Date#toISOString(), so text comparison works.
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// The three kinds of user. Only passengers sign up themselves; the SACCO office (admin) creates conductors.
// Vehicle owners don't log in: the admin records their name and M-Pesa number for payouts.
export const ROLES = ['admin', 'passenger', 'conductor'];

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
  type          TEXT NOT NULL CHECK (type IN ('topup', 'fare', 'refund', 'test_credit')),
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
  purpose             TEXT NOT NULL CHECK (purpose IN ('wallet', 'fare')),
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

-- Last run of scheduled jobs, so a restart never runs the daily payout twice.
CREATE TABLE IF NOT EXISTS job_runs (
  name     TEXT PRIMARY KEY,
  last_run TEXT NOT NULL
);
`);

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

/**
 * Runs fn inside a write transaction. fn must be synchronous (no await inside),
 * which together with node:sqlite's synchronous API makes it atomic.
 */
export function tx(fn) {
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
