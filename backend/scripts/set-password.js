// Sets a new password for any account, e.g. a platform admin who forgot theirs (nobody else can reset it). Usage:
//   yarn set-password --phone 0712345678 --password "Strong-Pass1"
import bcrypt from 'bcryptjs';
import { parseArgs } from 'node:util';
import { closeDatabase, db } from '../src/database.js';
import { setPassword } from '../src/services/users.js';
import { normalizePhone } from '../src/util.js';
import { PASSWORD_RULE, passwordOk } from '../src/validate.js';

const { values } = parseArgs({ options: { phone: { type: 'string' }, password: { type: 'string' } } });

const phone = normalizePhone(values.phone);
if (!phone || !passwordOk(values.password)) {
  console.error(`Usage: yarn set-password --phone 07XXXXXXXX --password <password>\n${PASSWORD_RULE}`);
  process.exit(1);
}

try {
  const user = await db.get('SELECT id, name FROM users WHERE phone = ?', phone);
  if (!user) throw new Error('No account has this phone number');
  await setPassword(user.id, await bcrypt.hash(values.password, 10));
  console.log(`New password set for ${user.name}. Every phone signed in with the old one is signed out.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
