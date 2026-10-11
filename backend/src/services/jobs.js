// Daily background jobs (owner payouts, the money check). Each runs once a day after its time (HH:MM,
// Kenyan time), and the last run date is kept in job_runs so a server restart never runs it twice.
import { db } from '../db.js';
import { nairobiToday } from '../util.js';

export function runDaily(name, at, fn) {
  const [hh, mm] = at.split(':').map(Number);
  let running = false;
  setInterval(async () => {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000); // Kenya is UTC+3
    const due = now.getUTCHours() * 60 + now.getUTCMinutes() >= hh * 60 + mm;
    const today = nairobiToday();
    if (running || !due || db.prepare('SELECT last_run FROM job_runs WHERE name = ?').get(name)?.last_run === today) return;
    running = true;
    try {
      db.prepare('INSERT INTO job_runs (name, last_run) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run').run(name, today);
      await fn(today);
    } catch (err) {
      console.error(`[${name}] failed:`, err.message);
    } finally {
      running = false;
    }
  }, 60_000);
}
