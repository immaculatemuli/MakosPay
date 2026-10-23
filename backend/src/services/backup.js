// Nightly database backup: a complete, consistent copy (taken safely while the server keeps running), named
// by date, with the oldest deleted so only the newest BACKUP_KEEP stay. Copy the backups folder off the
// server too (see deploy/README.md): a backup on the same disk doesn't survive losing that disk.
// SQLite: a copy of the database file (.db). PostgreSQL: a pg_dump archive (.pgdump, restore with pg_restore).
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { backupTo, isPostgres } from '../database.js';
import { nairobiToday } from '../util.js';
import { runDaily } from './jobs.js';
import { notifyOffice } from './notifications.js';

export const BACKUP_EXTENSION = isPostgres ? 'pgdump' : 'db';
const NAME = new RegExp(`^farepay-\\d{4}-\\d{2}-\\d{2}\\.${BACKUP_EXTENSION}$`);

/** Writes today's backup (replacing one already made today) and removes old ones. Returns the file path. */
export async function backupNow(dir = config.backupDir, keep = config.backupKeep, date = nairobiToday()) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `farepay-${date}.${BACKUP_EXTENSION}`);
  rmSync(file, { force: true }); // SQLite's VACUUM INTO refuses to overwrite
  await backupTo(file);
  const old = readdirSync(dir).filter((f) => NAME.test(f)).sort().slice(0, -keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return { file, bytes: statSync(file).size, removed: old };
}

export function startNightlyBackup() {
  if (!isPostgres && config.dbPath === ':memory:') return;
  runDaily('db_backup', config.backupDailyAt, async () => {
    try {
      const { file, bytes } = await backupNow();
      console.log(`[backup] saved ${file} (${Math.round(bytes / 1024)} KB)`);
    } catch (err) {
      await notifyOffice({ kind: 'backup.failed', title: 'Nightly database backup failed', body: `${err.message}. Tell whoever runs the FarePay server.`, target: null });
      throw err;
    }
  });
}
