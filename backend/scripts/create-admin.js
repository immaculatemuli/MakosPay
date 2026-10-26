// Creates a SACCO office account, or (with --platform) a platform admin account. Usage:
//   yarn create-admin --name "Jane Doe" --phone 0712345678 --password "Strong-Pass1"
//   yarn create-admin --platform --name "Jane Doe" --phone 0712345678 --password "Strong-Pass1"
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { closeDatabase, isPostgres } from '../src/database.js';
import { createUser } from '../src/services/users.js';
import { normalizePhone } from '../src/util.js';
import { PASSWORD_RULE, passwordOk } from '../src/validate.js';

const { values } = parseArgs({
  options: { name: { type: 'string' }, phone: { type: 'string' }, password: { type: 'string' }, platform: { type: 'boolean', default: false } },
});

const phone = normalizePhone(values.phone);
if (!values.name || !phone || !passwordOk(values.password)) {
  console.error(`Usage: yarn create-admin [--platform] --name "Full Name" --phone 07XXXXXXXX --password <password>\n${PASSWORD_RULE}.`);
  process.exit(1);
}

const role = values.platform ? 'platform_admin' : 'admin';
const where = isPostgres ? 'the PostgreSQL database (DATABASE_URL)' : config.dbPath;
try {
  const user = await createUser({ name: values.name, phone, password: values.password, role });
  const kind = values.platform ? 'Platform admin' : 'SACCO office';
  console.log(`${kind} account created in ${where}: ${user.name} (${user.phone}). Sign in to the app with this phone and password.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
