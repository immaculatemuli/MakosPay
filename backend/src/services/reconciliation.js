// Reconciliation: checks that the money recorded in FarePay adds up, so mistakes or tampering show.
// It only reads. "Test" money (test credit, M-Pesa sandbox/mock) is reported separately from real money.
import { config } from '../config.js';
import { db } from '../db.js';
import { owedByOwner } from './payouts.js';

const one = (sql, ...params) => db.prepare(sql).get(...params).n;

export function reconcile() {
  const live = config.paymentProvider === 'intasend' ? config.intasend.mode === 'live' : config.mpesa.mode === 'production';

  // 1. Every wallet balance equals the sum of its history.
  const walletMismatches = db
    .prepare(
      `SELECT w.user_id, u.name, w.balance, COALESCE(SUM(t.amount), 0) AS ledger
       FROM wallets w JOIN users u ON u.id = w.user_id LEFT JOIN wallet_transactions t ON t.user_id = w.user_id
       GROUP BY w.user_id HAVING w.balance != COALESCE(SUM(t.amount), 0)`,
    )
    .all();

  // 2. Each history entry's "balance after" follows from the one before it.
  const brokenChains = one(
    `SELECT COUNT(*) AS n FROM wallet_transactions t
     WHERE t.balance_after != t.amount + COALESCE((SELECT p.balance_after FROM wallet_transactions p
                                                  WHERE p.user_id = t.user_id AND p.id < t.id ORDER BY p.id DESC LIMIT 1), 0)`,
  );

  // 3. Money in from M-Pesa equals what was credited to wallets for M-Pesa.
  const mpesaCompleted = one("SELECT COALESCE(SUM(amount), 0) AS n FROM mpesa_payments WHERE status = 'completed'");
  const mpesaCredited = one("SELECT COALESCE(SUM(amount), 0) AS n FROM wallet_transactions WHERE type = 'topup'");

  // 4. Every paid fare was taken from a wallet exactly once.
  const tripsWithoutDebit = one(
    `SELECT COUNT(*) AS n FROM trips t WHERE NOT EXISTS (
       SELECT 1 FROM wallet_transactions w WHERE w.user_id = t.passenger_id AND w.type = 'fare' AND w.reference = t.ticket_code AND w.amount = -t.fare)`,
  );
  const refundsWithoutCredit = one(
    `SELECT COUNT(*) AS n FROM trips t WHERE t.status = 'refunded' AND NOT EXISTS (
       SELECT 1 FROM wallet_transactions w WHERE w.user_id = t.passenger_id AND w.type = 'refund' AND w.reference = t.ticket_code AND w.amount = t.fare)`,
  );

  // 5. Fares owed to owners: paid fares = paid out + being paid out + still owed (refunds after payout are taken back).
  const faresPaid = one("SELECT COALESCE(SUM(fare), 0) AS n FROM trips WHERE status = 'paid'");
  const inPayouts = (statuses) =>
    one(`SELECT COALESCE(SUM(t.fare), 0) AS n FROM trips t JOIN payouts p ON p.id = t.payout_id WHERE t.status = 'paid' AND p.status IN (${statuses})`);
  const faresPaidOut = inPayouts("'completed'");
  const faresBeingPaid = inPayouts("'processing', 'manual'");
  const faresUnpaid = one("SELECT COALESCE(SUM(fare), 0) AS n FROM trips WHERE status = 'paid' AND payout_id IS NULL");
  const owedNow = owedByOwner().reduce((sum, o) => sum + o.amount, 0);

  // 6. Each payout's amount equals its fares minus the refunds it took back.
  const payoutMismatches = db
    .prepare(
      `SELECT p.id, p.owner_name, p.amount,
              COALESCE((SELECT SUM(fare) FROM trips WHERE payout_id = p.id AND status = 'paid'), 0)
                + COALESCE((SELECT SUM(fare) FROM trips WHERE payout_id = p.id AND status = 'refunded'), 0)
                - COALESCE((SELECT SUM(amount) FROM owner_deductions WHERE payout_id = p.id), 0) AS expected
       FROM payouts p WHERE p.status != 'failed'`,
    )
    .all()
    .filter((p) => p.amount !== p.expected);

  const totals = {
    real_money: live,
    mpesa_collected: mpesaCompleted,
    test_credit: one("SELECT COALESCE(SUM(amount), 0) AS n FROM wallet_transactions WHERE type = 'test_credit'"),
    refunds_to_wallets: one("SELECT COALESCE(SUM(amount), 0) AS n FROM wallet_transactions WHERE type = 'refund'"),
    fares_paid: faresPaid,
    wallet_balances: one('SELECT COALESCE(SUM(balance), 0) AS n FROM wallets'),
    paid_out_to_owners: one("SELECT COALESCE(SUM(amount), 0) AS n FROM payouts WHERE status = 'completed'"),
    being_paid_out: one("SELECT COALESCE(SUM(amount), 0) AS n FROM payouts WHERE status IN ('processing', 'manual')"),
    owed_to_owners: owedNow,
    refunds_to_take_back: one('SELECT COALESCE(SUM(amount), 0) AS n FROM owner_deductions WHERE payout_id IS NULL'),
    mpesa_pending: one("SELECT COALESCE(SUM(amount), 0) AS n FROM mpesa_payments WHERE status = 'pending'"),
  };

  const checks = [
    {
      name: 'Every wallet balance matches its history',
      ok: walletMismatches.length === 0,
      detail: walletMismatches.length ? walletMismatches.map((w) => `${w.name}: balance ${w.balance}, history ${w.ledger}`).join('; ') : null,
    },
    { name: 'Wallet history adds up entry by entry', ok: brokenChains === 0, detail: brokenChains ? `${brokenChains} entries out of step` : null },
    {
      name: 'M-Pesa received equals M-Pesa credited to wallets',
      ok: mpesaCompleted === mpesaCredited,
      detail: mpesaCompleted === mpesaCredited ? null : `received ${mpesaCompleted}, credited ${mpesaCredited}`,
    },
    { name: 'Every fare was taken from a wallet once', ok: tripsWithoutDebit === 0, detail: tripsWithoutDebit ? `${tripsWithoutDebit} fares without a wallet entry` : null },
    { name: 'Every refund went back to a wallet', ok: refundsWithoutCredit === 0, detail: refundsWithoutCredit ? `${refundsWithoutCredit} refunds without a wallet entry` : null },
    {
      name: 'Fares = paid to owners + being paid + still owed',
      ok: faresPaid === faresPaidOut + faresBeingPaid + faresUnpaid,
      detail: faresPaid === faresPaidOut + faresBeingPaid + faresUnpaid ? null : `fares ${faresPaid} vs ${faresPaidOut} + ${faresBeingPaid} + ${faresUnpaid}`,
    },
    {
      name: 'Each payout amount matches its fares',
      ok: payoutMismatches.length === 0,
      detail: payoutMismatches.length ? payoutMismatches.map((p) => `payout #${p.id} ${p.owner_name}: ${p.amount} vs ${p.expected}`).join('; ') : null,
    },
  ];

  return { checked_at: new Date().toISOString(), all_ok: checks.every((c) => c.ok), checks, totals };
}
