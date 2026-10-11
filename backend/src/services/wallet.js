import { db, insertId, NOW } from '../db.js';
import { HttpError } from '../errors.js';

export const getBalance = (userId) => db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId)?.balance ?? 0;

/**
 * Adds money to (amount > 0) or takes money from (amount < 0) a wallet and records it.
 * Must be called inside tx().
 */
export function postWalletEntry(userId, { type, amount, reference = null, description = null }) {
  const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId);
  if (!wallet) throw new HttpError(404, 'WALLET_NOT_FOUND', 'Wallet not found');

  const balanceAfter = wallet.balance + amount;
  if (balanceAfter < 0) {
    throw new HttpError(402, 'INSUFFICIENT_FUNDS', 'Not enough money in your wallet. Please top up.', {
      balance: wallet.balance,
      shortfall: -balanceAfter,
    });
  }

  db.prepare(`UPDATE wallets SET balance = ?, updated_at = ${NOW} WHERE user_id = ?`).run(balanceAfter, userId);
  const id = insertId(
    db
      .prepare('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, reference, description) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, type, amount, balanceAfter, reference, description),
  );
  return { id, balanceAfter };
}
