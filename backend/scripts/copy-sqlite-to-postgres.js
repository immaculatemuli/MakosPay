// Copies every row of the SQLite database into PostgreSQL (for the switch-over), keeping all ids, then checks
// that every row arrived unchanged. All or nothing: one transaction, undone completely if anything fails.
// It refuses to copy into a PostgreSQL database that already has FarePay data, and never changes the SQLite file.
//   yarn db:copy-from-sqlite                     SQLite DB_PATH -> PostgreSQL DATABASE_URL
//   yarn db:copy-from-sqlite --from <file.db>    another SQLite file (e.g. a copy)
// (DB_SCHEMA works as everywhere else, for rehearsals on a _test database.)
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { createPool, migrate } from '../src/postgres.js';

// Parents before children, so every reference points at a row that is already there.
export const TABLES = [
  'users', 'routes', 'route_stops', 'vehicles', 'fare_changes', 'saved_stops', 'wallets', 'wallet_transactions', 'payouts',
  'trips', 'owner_deductions', 'mpesa_payments', 'withdrawals', 'reports', 'notifications', 'audit_log', 'job_runs',
];

const { values } = parseArgs({ options: { from: { type: 'string' } } });
const from = values.from ?? config.dbPath;
if (!existsSync(from)) throw new Error(`SQLite file not found: ${from}`);
const sqlite = new DatabaseSync(from, { readOnly: true });

// Switch only when no money is in flight: a callback for a payment half-way through could otherwise arrive
// while neither database is running. (Pending M-Pesa payments would still be confirmed afterwards by the
// background check, but there is no reason to take that chance.)
const inFlight = {
  'M-Pesa payments waiting for confirmation': sqlite.prepare("SELECT COUNT(*) AS n FROM mpesa_payments WHERE status IN ('initiating', 'pending')").get().n,
  'owner payouts in progress': sqlite.prepare("SELECT COUNT(*) AS n FROM payouts WHERE status IN ('processing', 'manual')").get().n,
  'withdrawals in progress': sqlite.prepare("SELECT COUNT(*) AS n FROM withdrawals WHERE status IN ('processing', 'manual')").get().n,
};
const busy = Object.entries(inFlight).filter(([, n]) => n > 0);
if (busy.length) {
  console.error(`Nothing was copied: finish these first (in the app), then try again: ${busy.map(([what, n]) => `${n} ${what}`).join('; ')}`);
  process.exit(1);
}

const schema = config.dbSchema;
if (schema && !/\/[\w-]*_test(\?.*)?$/.test(config.databaseUrl ?? '')) throw new Error('DB_SCHEMA is only allowed on a _test database');
const pool = createPool(config.databaseUrl, schema ? { options: `-c search_path=${schema}` } : {});

// PostgreSQL's JSONB keeps an object's fields in its own order; the values are what must match.
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

/** One row in a form both databases can be compared by: times as ISO text, true/false as 1/0, JSON by content. */
function comparable(row, types) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (types[k] === 'boolean') out[k] = v === true || v === 1 ? 1 : 0;
    else if (types[k] === 'timestamp with time zone') out[k] = new Date(v).toISOString();
    else if (types[k] === 'jsonb') out[k] = JSON.stringify(sortKeys(typeof v === 'string' ? JSON.parse(v) : v));
    else out[k] = v;
  }
  return JSON.stringify(out);
}

try {
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await migrate(pool);
  const client = await pool.connect();
  const report = [];
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    for (const table of TABLES) {
      const existing = (await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n;
      if (existing > 0) throw new Error(`PostgreSQL already has ${existing} rows in ${table}: refusing to copy over existing data`);
    }
    for (const table of TABLES) {
      const cols = (await client.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position', [table])).rows;
      const types = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
      const names = cols.map((c) => c.column_name);
      const order = names.includes('id') ? 'id' : names.slice(0, 2).join(', ');
      const rows = sqlite.prepare(`SELECT ${names.join(', ')} FROM ${table} ORDER BY ${order}`).all();
      for (const row of rows) {
        const params = names.map((n) => (row[n] === null ? null : types[n] === 'boolean' ? row[n] !== 0 : row[n]));
        await client.query(`INSERT INTO ${table} (${names.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`, params);
      }
      // New rows continue numbering after the copied ones.
      if (names.includes('id')) {
        await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT max(id) FROM ${table}), 1), (SELECT max(id) FROM ${table}) IS NOT NULL)`, [table]);
      }
      // Check: every row arrived, with exactly the same values.
      const copied = (await client.query(`SELECT ${names.join(', ')} FROM ${table} ORDER BY ${order}`)).rows;
      const a = rows.map((r) => comparable(r, types));
      const b = copied.map((r) => comparable(r, types));
      const different = a.filter((x, i) => x !== b[i]).length + Math.abs(a.length - b.length);
      if (different) throw new Error(`${table}: ${different} row(s) differ after copying`);
      report.push(`${table} ${rows.length}`);
    }
    await client.query('COMMIT');
    console.log(`Copied and checked, row for row: ${report.join(', ')}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error(`Nothing was copied: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
