// Brings the PostgreSQL database up to date with migrations/. Safe to run any number of times.
//   yarn db:migrate          -> the database in DATABASE_URL
//   yarn db:migrate --test   -> the test database in TEST_DATABASE_URL
import { createPool, migrate } from '../src/postgres.js';

const test = process.argv.includes('--test');
const name = test ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
const pool = createPool(process.env[name]);
try {
  const applied = await migrate(pool);
  const { rows } = await pool.query('SELECT current_database() AS db, count(*) AS tables FROM information_schema.tables WHERE table_schema = $1', ['public']);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
  console.log(`Database "${rows[0].db}" (${name}) now has ${rows[0].tables} tables.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
