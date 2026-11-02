// PostgreSQL connection, migrations and backups. The app reaches it through database.js (DB_ENGINE=postgres).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// COUNT(*) and SUM(integer) come back as bigint, which `pg` gives as text. FarePay's counts and shilling
// totals are far below 2^53, so read them as normal numbers (and fail loudly if one ever isn't).
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Number too large for JavaScript: ${value}`);
  return n;
});

export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

export function createPool(connectionString, extra = {}) {
  if (!connectionString) throw new Error('No PostgreSQL address: set DATABASE_URL (or TEST_DATABASE_URL for tests) in backend/.env');
  // allowExitOnIdle: scripts and tests can finish without closing the pool by hand.
  return new pg.Pool({ connectionString, max: 10, allowExitOnIdle: true, ...extra });
}

// The operating system's trusted certificates (Debian/Ubuntu, e.g. Render; then Red Hat-style systems).
const SYSTEM_CA_FILES = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'];

/**
 * pg_dump checking the server's certificate (sslmode verify-full or verify-ca, as Neon's addresses can ask) looks for
 * ~/.postgresql/root.crt unless told otherwise, which hosts like Render don't have: point it at the system's trusted
 * certificates instead. Nothing changes when the address names its own sslrootcert.
 */
function sslRootEnv(url) {
  const mode = url.searchParams.get('sslmode') ?? process.env.PGSSLMODE ?? '';
  if (!mode.startsWith('verify') || url.searchParams.has('sslrootcert') || process.env.PGSSLROOTCERT) return {};
  const file = SYSTEM_CA_FILES.find((f) => existsSync(f));
  return file ? { PGSSLROOTCERT: file } : {};
}

/** A full backup with pg_dump (custom format, restore with pg_restore). `schema` limits it to one schema. */
export function pgDump(connectionString, file, schema = null) {
  return new Promise((resolve, reject) => {
    // The password goes in the environment, never on the command line (other programs can see command lines).
    const url = new URL(connectionString);
    const password = decodeURIComponent(url.password);
    url.password = '';
    const args = ['--format=custom', '--no-owner', '--no-password', `--file=${file}`, ...(schema ? [`--schema=${schema}`] : []), `--dbname=${url}`];
    const child = spawn('pg_dump', args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...sslRootEnv(url), PGPASSWORD: password } });
    let errors = '';
    child.stderr.on('data', (d) => (errors += d));
    child.on('error', (err) => reject(new Error(`pg_dump could not start (is PostgreSQL's bin folder on PATH?): ${err.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump failed: ${errors.trim()}`))));
  });
}

const checksum = (sql) => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

/**
 * Applies every migrations/NNN_name.sql not applied yet, in order, each in its own transaction, and records
 * it in schema_migrations. Refuses to continue if an applied file was edited afterwards. Safe to run any
 * number of times, and from two places at once (an advisory lock makes the second one wait).
 */
export async function migrate(pool, dir = MIGRATIONS_DIR) {
  if (dir instanceof URL) dir = fileURLToPath(dir);
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['farepay_migrations']);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const done = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const sum = checksum(sql);
      if (done.has(file)) {
        if (done.get(file) !== sum) throw new Error(`Migration ${file} was changed after it was applied. Put changes in a new numbered file.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed and was undone: ${err.message}`);
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['farepay_migrations']).catch(() => {});
    client.release();
  }
  return applied;
}
