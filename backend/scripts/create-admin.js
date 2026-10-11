// Creates a SACCO office (admin) account. Usage:
//   npm run create-admin -- --name "Jane Doe" --phone 0712345678 --password "a-strong-password"
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { createUser } from '../src/services/users.js';
import { normalizePhone } from '../src/util.js';

const { values } = parseArgs({
  options: { name: { type: 'string' }, phone: { type: 'string' }, password: { type: 'string' } },
});

const phone = normalizePhone(values.phone);
if (!values.name || !phone || !values.password || values.password.length < 6) {
  console.error('Usage: npm run create-admin -- --name "Full Name" --phone 07XXXXXXXX --password <at least 6 characters>');
  process.exit(1);
}

try {
  const user = await createUser({ name: values.name, phone, password: values.password, role: 'admin' });
  console.log(`SACCO office account created in ${config.dbPath}: ${user.name} (${user.phone}). Log in to the app with this phone and password.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
