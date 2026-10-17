import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, tx } from '../database.js';
import { HttpError } from '../errors.js';

export const getUser = (id) => db.get('SELECT id, name, phone, role, is_active, created_at FROM users WHERE id = ?', id);

// The password of a passenger who has only paid from the phone camera page (no app): it is not a bcrypt hash,
// so no password ever matches it and nobody can sign in as them.
export const NO_APP_PASSWORD = 'no-app-passenger';

export async function createUser({ name, phone, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return tx(async () => {
    const existing = await db.get('SELECT id, role, password_hash, is_active FROM users WHERE phone = ?', phone);
    // Someone who paid without the app now signs up with that number: their fares and wallet become theirs.
    if (existing && role === 'passenger' && existing.role === 'passenger' && existing.password_hash === NO_APP_PASSWORD && existing.is_active) {
      await db.run('UPDATE users SET name = ?, password_hash = ?, session_version = session_version + 1 WHERE id = ?', name, passwordHash, existing.id);
      return getUser(existing.id);
    }
    if (existing) {
      throw new HttpError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
    }
    const id = await db.insert('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)', name, phone, passwordHash, role);
    if (role === 'passenger') await db.run('INSERT INTO wallets (user_id) VALUES (?)', id);
    return getUser(id);
  });
}

// Checked when the phone number has no account, so a wrong number takes as long as a wrong password
// (otherwise the answer time would tell people which numbers are registered).
const NO_ACCOUNT_HASH = bcrypt.hashSync(randomUUID(), 10);

export async function verifyCredentials(phone, password) {
  const user = await db.get('SELECT * FROM users WHERE phone = ?', phone);
  const matches = await bcrypt.compare(password, user?.password_hash ?? NO_ACCOUNT_HASH);
  const ok = user && matches;
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong phone number or password');
  if (!user.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact the SACCO office.');
  return getUser(user.id);
}

/** The SACCO office sets a new password for a passenger, conductor or driver who forgot theirs. */
export async function resetPassword(userId, newPassword) {
  const user = await db.get("SELECT id FROM users WHERE id = ? AND role IN ('passenger', 'conductor', 'driver', 'marshal')", userId);
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Passenger, conductor or driver not found');
  await setPassword(userId, await bcrypt.hash(newPassword, 10));
}

/** A passenger corrects their own name (crew and office names are set by the SACCO office). */
export async function renameSelf(user, newName) {
  if (user.role !== 'passenger') throw new HttpError(403, 'FORBIDDEN', 'Ask the SACCO office to change your name');
  await db.run('UPDATE users SET name = ? WHERE id = ?', newName, user.id);
  return getUser(user.id);
}

/** Saves a new password and signs out every phone using the old one. */
export const setPassword = (userId, hash) => db.run('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?', hash, userId);

/**
 * A passenger deletes their account (required by Google Play). Their name and phone number are removed
 * and they can't sign in again. Payment records stay, without their details, for the SACCO's accounts.
 * Money left in the wallet must be refunded by the office first, so nobody loses money by mistake.
 */
export async function deleteOwnAccount(userId, currentPassword) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Your password is incorrect');
  }
  if (user.role !== 'passenger') throw new HttpError(403, 'FORBIDDEN', 'Only passenger accounts can be deleted here');
  const balance = (await db.get('SELECT balance FROM wallets WHERE user_id = ?', userId))?.balance ?? 0;
  if (balance > 0) {
    throw new HttpError(409, 'WALLET_NOT_EMPTY', `Your wallet still has KES ${balance}. Withdraw it to M-Pesa from your Wallet (or use it for fares), then delete your account.`);
  }
  const unusable = await bcrypt.hash(randomUUID(), 10);
  await db.run(
    "UPDATE users SET name = 'Deleted passenger', phone = ?, password_hash = ?, is_active = FALSE, session_version = session_version + 1 WHERE id = ?",
    `deleted-${userId}`,
    unusable,
    userId,
  );
}

// A delete refused because other rows still point at the user (SQLite / PostgreSQL).
const isStillReferenced = (err) => err?.errcode === 787 || err?.code === '23503';

/**
 * The office deletes a conductor or driver, completely. Their vehicle is freed and everything that was only
 * theirs (notifications, phones for push, password codes) goes. If they never worked (no trips, no audit log
 * entries...), the account itself is removed. Otherwise the money records and the audit log (which can't be
 * changed) must keep pointing at someone: the account stays as "Deleted conductor/driver", with no name or phone,
 * and can never sign in. Either way their phone number is free for a new account.
 */
export async function deleteCrewMember(userId, role, column) {
  const unusable = await bcrypt.hash(randomUUID(), 10);
  return tx(async () => {
    const user = await db.get("SELECT id FROM users WHERE id = ? AND role = ? AND phone NOT LIKE 'deleted-%'", userId, role);
    if (!user) return false;
    if (column) await db.run(`UPDATE vehicles SET ${column} = NULL WHERE ${column} = ?`, userId);
    for (const table of ['push_tokens', 'password_resets', 'notifications']) {
      await db.run(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    }
    // Try removing the account; if records still point at it, undo just that and wipe their details instead.
    await db.exec('SAVEPOINT delete_crew');
    try {
      await db.run('DELETE FROM users WHERE id = ?', userId);
      await db.exec('RELEASE SAVEPOINT delete_crew');
    } catch (err) {
      if (!isStillReferenced(err)) throw err;
      await db.exec('ROLLBACK TO SAVEPOINT delete_crew');
      await db.exec('RELEASE SAVEPOINT delete_crew');
      await db.run(
        'UPDATE users SET name = ?, phone = ?, password_hash = ?, is_active = FALSE, session_version = session_version + 1 WHERE id = ?',
        `Deleted ${role}`,
        `deleted-${userId}`,
        unusable,
        userId,
      );
    }
    return true;
  });
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await db.get('SELECT password_hash FROM users WHERE id = ?', userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Your current password is incorrect');
  }
  await setPassword(userId, await bcrypt.hash(newPassword, 10));
}
