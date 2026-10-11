// Makes a database backup now (the server also does this every night). Usage: npm run backup
const { backupNow } = await import('../src/services/backup.js');
const { file, bytes, removed } = backupNow();
console.log(`Backup saved: ${file} (${Math.round(bytes / 1024)} KB)`);
if (removed.length) console.log(`Old backups removed: ${removed.join(', ')}`);
