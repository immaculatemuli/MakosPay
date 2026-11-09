// Makes a database backup now (the server also does this every night). Usage: yarn backup
const { backupNow } = await import('../src/services/backup.js');
const { closeDatabase } = await import('../src/database.js');
try {
  const { file, bytes, removed } = await backupNow();
  console.log(`Backup saved: ${file} (${Math.round(bytes / 1024)} KB)`);
  if (removed.length) console.log(`Old backups removed: ${removed.join(', ')}`);
} finally {
  await closeDatabase();
}
