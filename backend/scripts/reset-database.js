// Empties the FarePay database completely and recreates it fresh (all users, payments, wallets, bookings, reports,
// the audit log, routes and vehicles are deleted). Take a backup first: yarn backup.
// Usage: node --env-file=.env scripts/reset-database.js --yes-delete-everything
import { createPool, migrate } from '../src/postgres.js';

if (!process.argv.includes('--yes-delete-everything')) {
  console.error('This deletes EVERYTHING in the database. Run it with --yes-delete-everything if you are sure.');
  process.exit(1);
}
const pool = createPool(process.env.DATABASE_URL);
try {
  const { d } = (await pool.query('SELECT current_database() AS d')).rows[0];
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const applied = await migrate(pool);
  const users = (await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n;
  console.log(`Database "${d}" is empty and fresh (${applied.length} migrations applied, ${users} users).`);
} finally {
  await pool.end();
}
