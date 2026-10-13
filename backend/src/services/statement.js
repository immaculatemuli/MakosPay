// Compares an M-Pesa business statement (the CSV downloaded from the M-Pesa org portal) with FarePay's
// records, so the office can see that every shilling in and out of the Paybill is accounted for:
//   - money in:  passengers' M-Pesa payments (top-ups and fares) and parcel fees paid by the PIN prompt, matched by M-Pesa receipt number
//   - money out: owner payouts and passenger withdrawals, matched by M-Pesa transaction code
// It only reads. Nothing in the statement changes FarePay's records.
import { db } from '../database.js';

/** Splits CSV text into rows of cells (handles quotes, commas and line breaks inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

const money = (text) => {
  const n = Number(String(text ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(Math.abs(n)) : 0;
};

/** Statement times are Kenyan local time, e.g. "2026-10-11 14:03:22" or "11/10/2026 14:03:22". */
function toIso(text) {
  const t = String(text ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+03:00`).toISOString();
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const pad = (s) => s.padStart(2, '0');
    return new Date(`${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:${m[6] ?? '00'}+03:00`).toISOString();
  }
  return null;
}

/** The statement's transactions. Throws a clear message if this doesn't look like an M-Pesa statement. */
export function readStatement(text) {
  const rows = parseCsv(String(text ?? '').replace(/^﻿/, ''));
  const headerAt = rows.findIndex((r) => r.some((c) => /^receipt/i.test(c)) && r.some((c) => /paid\s*in/i.test(c)));
  if (headerAt < 0) throw new Error('This file does not look like an M-Pesa statement: no "Receipt No." and "Paid In" columns were found.');
  const header = rows[headerAt].map((c) => c.toLowerCase());
  const col = (pattern) => header.findIndex((c) => pattern.test(c));
  const at = {
    receipt: col(/^receipt/),
    completed: col(/completion/),
    initiated: col(/initiation/),
    details: col(/details/),
    status: col(/status/),
    paidIn: col(/paid\s*in/),
    withdrawn: col(/withdrawn/),
    reason: col(/reason/),
    other: col(/other party/),
  };
  const get = (r, i) => (i >= 0 ? (r[i] ?? '') : '');

  return rows
    .slice(headerAt + 1)
    .filter((r) => get(r, at.receipt))
    .map((r) => ({
      receipt: get(r, at.receipt).toUpperCase(),
      time: toIso(get(r, at.completed) || get(r, at.initiated)),
      details: get(r, at.details),
      status: get(r, at.status),
      paid_in: money(get(r, at.paidIn)),
      withdrawn: money(get(r, at.withdrawn)),
      reason: get(r, at.reason),
      other_party: get(r, at.other),
    }))
    .filter((t) => !t.status || /complete/i.test(t.status));
}

const isCharge = (t) => /charge|fee/i.test(`${t.details} ${t.reason}`);

/** Matches the statement against FarePay. Each problem list says exactly which receipt to look at. */
export async function checkStatement(text) {
  const rows = readStatement(text);
  if (rows.length === 0) throw new Error('The statement has no completed transactions.');
  const times = rows.map((t) => t.time).filter(Boolean).sort();
  const [from, to] = [times[0] ?? null, times.at(-1) ?? null];

  // FarePay's side: confirmed M-Pesa money in, and money sent out with an M-Pesa code.
  // (Parcel fees paid by the PIN prompt go to the same Paybill, so they are on the statement too.)
  const mpesaIn = new Map(
    [
      ...(await db.all("SELECT id, mpesa_receipt AS receipt, amount, purpose, completed_at FROM mpesa_payments WHERE status = 'completed' AND mpesa_receipt IS NOT NULL")),
      ...(await db.all("SELECT id, mpesa_receipt AS receipt, amount, 'parcel' AS purpose, completed_at FROM parcel_payments WHERE status = 'completed' AND mpesa_receipt IS NOT NULL")),
    ].map((p) => [p.receipt.toUpperCase(), p]),
  );
  const out = new Map(
    [
      ...(await db.all("SELECT id, 'payout' AS kind, reference, amount, owner_name AS name, completed_at FROM payouts WHERE status = 'completed' AND reference IS NOT NULL")),
      ...(await db.all(
        "SELECT w.id, 'withdrawal' AS kind, w.reference, w.amount, u.name, w.completed_at FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = 'completed' AND w.reference IS NOT NULL",
      )),
    ].map((o) => [o.reference.toUpperCase(), o]),
  );

  const result = {
    period: { from, to },
    transactions: rows.length,
    money_in: { matched: 0, amount: 0, wrong_amount: [], not_in_farepay: [] },
    money_out: { matched: 0, amount: 0, wrong_amount: [], not_in_farepay: [] },
    charges: { count: 0, amount: 0 },
    not_in_statement: [],
  };
  const seen = new Set();

  for (const t of rows) {
    if (t.paid_in > 0) {
      const p = mpesaIn.get(t.receipt);
      if (!p) result.money_in.not_in_farepay.push({ receipt: t.receipt, amount: t.paid_in, time: t.time, details: t.details || t.other_party });
      else if (p.amount !== t.paid_in) result.money_in.wrong_amount.push({ receipt: t.receipt, statement: t.paid_in, farepay: p.amount });
      else {
        result.money_in.matched++;
        result.money_in.amount += t.paid_in;
      }
      seen.add(t.receipt);
    } else if (t.withdrawn > 0) {
      const o = out.get(t.receipt);
      if (o) {
        if (o.amount !== t.withdrawn) result.money_out.wrong_amount.push({ receipt: t.receipt, statement: t.withdrawn, farepay: o.amount, what: `${o.kind} to ${o.name}` });
        else {
          result.money_out.matched++;
          result.money_out.amount += t.withdrawn;
        }
        seen.add(t.receipt);
      } else if (isCharge(t)) {
        result.charges.count++;
        result.charges.amount += t.withdrawn;
      } else {
        result.money_out.not_in_farepay.push({ receipt: t.receipt, amount: t.withdrawn, time: t.time, details: t.details || t.other_party });
      }
    }
  }

  // FarePay records inside the statement's period that the statement doesn't have.
  if (from && to) {
    const inPeriod = (iso) => iso && iso >= from && iso <= to;
    for (const [receipt, p] of mpesaIn) {
      if (inPeriod(p.completed_at) && !seen.has(receipt)) result.not_in_statement.push({ receipt, amount: p.amount, what: { fare: 'fare paid by M-Pesa', parcel: 'parcel fee' }[p.purpose] ?? 'wallet top-up' });
    }
    for (const [receipt, o] of out) {
      if (inPeriod(o.completed_at) && !seen.has(receipt)) result.not_in_statement.push({ receipt, amount: o.amount, what: `${o.kind} to ${o.name}` });
    }
  }

  result.all_ok =
    result.money_in.wrong_amount.length === 0 &&
    result.money_in.not_in_farepay.length === 0 &&
    result.money_out.wrong_amount.length === 0 &&
    result.money_out.not_in_farepay.length === 0 &&
    result.not_in_statement.length === 0;
  return result;
}
