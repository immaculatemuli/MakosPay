// The one place the app talks to its database. Every call is async (await it), the way PostgreSQL works.
// While FarePay moves from SQLite to PostgreSQL there are two engines, chosen by DB_ENGINE:
//   sqlite   (default) the file in DB_PATH, set up by db.js
//   postgres DATABASE_URL, set up by migrations/ (see postgres.js)
// SQL is written once, with ? placeholders and SQL that both engines understand; the few differences are
// in `sql` below. Rows come back the same from both: times as ISO text ("...Z"), true/false as 1/0, JSON as text.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

export const isPostgres = config.dbEngine === 'postgres';

/** SQL that differs between the engines. */
export const sql = isPostgres
  ? {
      NOW: 'now()',
      /** Kenyan calendar day (YYYY-MM-DD) of a stored time. */
      nairobiDay: (col) => `to_char(${col} AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD')`,
      /** Kenyan hour (0-23) of a stored time. */
      nairobiHour: (col) => `CAST(EXTRACT(HOUR FROM ${col} AT TIME ZONE 'Africa/Nairobi') AS INTEGER)`,
      /** Distinct values joined with commas. */
      distinctList: (col) => `string_agg(DISTINCT ${col}, ',')`,
    }
  : {
      NOW: "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      nairobiDay: (col) => `date(${col}, '+3 hours')`,
      nairobiHour: (col) => `CAST(strftime('%H', ${col}, '+3 hours') AS INTEGER)`,
      distinctList: (col) => `GROUP_CONCAT(DISTINCT ${col})`,
    };
export const NOW = sql.NOW;

// The transaction this code is running in, if any (so nested calls join it instead of starting another).
const inTransaction = new AsyncLocalStorage();

let engine;
let starting;
const ready = () => (starting ??= (isPostgres ? startPostgres() : startSqlite()).then((e) => (engine = e)));

// ---------- SQLite ----------

async function startSqlite() {
  const { db: sqlite } = await import('./db.js');
  const statements = new Map();
  const prepare = (text) => {
    let s = statements.get(text);
    if (!s) statements.set(text, (s = sqlite.prepare(text)));
    return s;
  };
  const bind = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
  let queue = Promise.resolve();
  return {
    get: async (text, params) => prepare(text).get(...bind(params)),
    all: async (text, params) => prepare(text).all(...bind(params)),
    run: async (text, params) => ({ changes: Number(prepare(text).run(...bind(params)).changes) }),
    exec: async (text) => sqlite.exec(text),
    // One connection, so transactions take turns.
    transaction(fn) {
      const turn = queue.then(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await inTransaction.run({ sqlite: true }, fn);
          sqlite.exec('COMMIT');
          return result;
        } catch (err) {
          sqlite.exec('ROLLBACK');
          throw err;
        }
      });
      queue = turn.catch(() => {});
      return turn;
    },
    backupTo: async (file) => sqlite.prepare('VACUUM INTO ?').run(file),
    close: async () => {},
  };
}

// ---------- PostgreSQL ----------

const SERIALIZATION_FAILURES = new Set(['40001', '40P01']);

/** "? ... ?" -> "$1 ... $2", leaving question marks inside 'quoted text' alone. */
const numbered = new Map();
function toPostgres(text) {
  let out = numbered.get(text);
  if (out) return out;
  let n = 0;
  let quoted = false;
  out = '';
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  numbered.set(text, out);
  return out;
}

/** Rows look the same as SQLite's: ISO text times, 1/0, JSON as text. */
function sameAsSqlite(row) {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (v instanceof Date) row[key] = v.toISOString();
    else if (typeof v === 'boolean') row[key] = v ? 1 : 0;
    else if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) row[key] = JSON.stringify(v);
  }
  return row;
}

async function startPostgres() {
  const { createPool, migrate } = await import('./postgres.js');
  // Tests only: DB_ISOLATE gives every test file its own empty schema (so files can run at the same time);
  // DB_SCHEMA names one, so several processes (e.g. a server and a script) share it. Never on a real database.
  let schema = config.dbSchema ?? (config.dbIsolate ? `t_${process.pid}_${randomBytes(3).toString('hex')}` : null);
  if (schema) {
    if (!/\/[\w-]*_test(\?.*)?$/.test(config.databaseUrl ?? '')) throw new Error('DB_ISOLATE and DB_SCHEMA are only allowed on a database whose name ends in _test');
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('DB_SCHEMA must be a simple lowercase name');
  }
  const pool = createPool(config.databaseUrl, schema ? { options: `-c search_path=${schema}` } : {});
  if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await migrate(pool);

  const client = () => inTransaction.getStore()?.client ?? pool;
  const query = async (text, params) => client().query(toPostgres(text), params.map((p) => (p === undefined ? null : p)));
  return {
    get: async (text, params) => {
      const row = (await query(text, params)).rows[0];
      return row && sameAsSqlite(row);
    },
    all: async (text, params) => (await query(text, params)).rows.map(sameAsSqlite),
    run: async (text, params) => ({ changes: (await query(text, params)).rowCount }),
    exec: async (text) => client().query(text),
    // The strictest isolation: the database guarantees the result is as if transactions ran one at a time
    // (like SQLite). If two clash, one is undone and simply run again.
    async transaction(fn) {
      for (let attempt = 1; ; attempt++) {
        const conn = await pool.connect();
        try {
          await conn.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          const result = await inTransaction.run({ client: conn }, fn);
          await conn.query('COMMIT');
          return result;
        } catch (err) {
          await conn.query('ROLLBACK').catch(() => {});
          if (SERIALIZATION_FAILURES.has(err.code) && attempt < 10) {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
            continue;
          }
          throw err;
        } finally {
          conn.release();
        }
      }
    },
    backupTo: async (file) => {
      const { pgDump } = await import('./postgres.js');
      await pgDump(config.databaseUrl, file, schema);
    },
    close: () => pool.end(),
  };
}

// ---------- What the rest of the app uses ----------

export const db = {
  /** The first row, or undefined. */
  get: async (text, ...params) => (await ready()).get(text, params),
  all: async (text, ...params) => (await ready()).all(text, params),
  /** Runs a change; returns { changes } (how many rows it changed). */
  run: async (text, ...params) => (await ready()).run(text, params),
  /** Runs an INSERT and returns the new row's id. */
  insert: async (text, ...params) => (await (await ready()).get(`${text} RETURNING id`, params)).id,
  /** Several statements without parameters. */
  exec: async (text) => (await ready()).exec(text),
};

/**
 * Runs fn inside one transaction: everything it does happens completely or not at all, and it sees no
 * half-finished changes from others. Inside a transaction already, fn just joins it.
 */
export async function tx(fn) {
  if (inTransaction.getStore()) return fn();
  return (await ready()).transaction(fn);
}

/** A complete copy of the database in `file` (SQLite: a database file; PostgreSQL: a pg_dump archive). */
export const backupTo = async (file) => (await ready()).backupTo(file);

/** Closes the connection (scripts call this so they can exit). */
export async function closeDatabase() {
  if (starting) await (await ready()).close();
}
