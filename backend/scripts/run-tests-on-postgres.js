// Runs the normal test suite against PostgreSQL instead of SQLite. Usage: yarn test:postgres [test files...]
// Each test file gets its own empty schema in the TEST_DATABASE_URL database (whose name must end in _test),
// so files can run at the same time; the schemas are removed afterwards. Only TEST_DATABASE_URL is read from
// backend/.env: everything else is exactly as in `yarn test`.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';

const envFile = new URL('../.env', import.meta.url);
const url = process.env.TEST_DATABASE_URL ?? (existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).TEST_DATABASE_URL : undefined);
if (!url) throw new Error('Set TEST_DATABASE_URL in backend/.env');
if (!/\/[\w-]*_test(\?.*)?$/.test(url)) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');

async function dropTestSchemas() {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows } = await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%'");
    for (const { nspname } of rows) await pool.query(`DROP SCHEMA "${nspname}" CASCADE`);
    return rows.length;
  } finally {
    await pool.end();
  }
}

await dropTestSchemas();
const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, DB_ENGINE: 'postgres', DATABASE_URL: url, DB_ISOLATE: '1' },
});
const removed = await dropTestSchemas();
console.log(`\nPostgreSQL test schemas removed: ${removed}`);
process.exitCode = run.status ?? 1;
