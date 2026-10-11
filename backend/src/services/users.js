import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, insertId, tx } from '../db.js';
import { HttpError } from '../errors.js';

export const getUser = (id) =>
  db.prepare('SELECT id, name, phone, role, is_active, created_at FROM users WHERE id = ?').get(id);

export async function createUser({ name, phone, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return tx(() => {
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) {
      throw new HttpError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
    }
    const id = insertId(
      db.prepare('INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, ?)').run(name, phone, passwordHash, role),
    );
    if (role === 'passenger') db.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(id);
    return getUser(id);
  });
}

export async function verifyCredentials(phone, password) {
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong phone number or password');
  if (!user.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact the SACCO office.');
  return getUser(user.id);
}

/** The SACCO office sets a new password for a passenger, conductor or driver who forgot theirs. */
export async function resetPassword(userId, newPassword) {
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('passenger', 'conductor', 'driver')").get(userId);
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'Passenger, conductor or driver not found');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 10), userId);
}

/**
 * A passenger deletes their account (required by Google Play). Their name and phone number are removed
 * and they can't sign in again. Payment records stay, without their details, for the SACCO's accounts.
 * Money left in the wallet must be refunded by the office first, so nobody loses money by mistake.
 */
export async function deleteOwnAccount(userId, currentPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Your password is incorrect');
  }
  if (user.role !== 'passenger') throw new HttpError(403, 'FORBIDDEN', 'Only passenger accounts can be deleted here');
  const balance = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId)?.balance ?? 0;
  if (balance > 0) {
    throw new HttpError(409, 'WALLET_NOT_EMPTY', `Your wallet still has KES ${balance}. Use it for fares, or ask the SACCO office to refund it, then delete your account.`);
  }
  const unusable = await bcrypt.hash(randomUUID(), 10);
  db.prepare("UPDATE users SET name = 'Deleted passenger', phone = ?, password_hash = ?, is_active = 0 WHERE id = ?").run(`deleted-${userId}`, unusable, userId);
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'WRONG_PASSWORD', 'Your current password is incorrect');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 10), userId);
}
