// Daily background jobs (owner payouts, the money check). Each runs once a day after its time (HH:MM,
// Kenyan time), and the last run date is kept in job_runs so a server restart never runs it twice.
import { db, tx } from '../database.js';
import { nairobiToday } from '../util.js';

/** Claims today's run of a job: true for exactly one caller per day, even with two at the same moment. */
export function claimDailyRun(name, today = nairobiToday()) {
  return tx(async () => {
    if ((await db.get('SELECT last_run FROM job_runs WHERE name = ?', name))?.last_run === today) return false;
    await db.run('INSERT INTO job_runs (name, last_run) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run', name, today);
    return true;
  });
}

export function runDaily(name, at, fn) {
  const [hh, mm] = at.split(':').map(Number);
  let running = false;
  setInterval(async () => {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000); // Kenya is UTC+3
    const due = now.getUTCHours() * 60 + now.getUTCMinutes() >= hh * 60 + mm;
    if (running || !due) return;
    running = true;
    try {
      const today = nairobiToday();
      if (await claimDailyRun(name, today)) await fn(today);
    } catch (err) {
      console.error(`[${name}] failed:`, err.message);
    } finally {
      running = false;
    }
  }, 60_000);
}
