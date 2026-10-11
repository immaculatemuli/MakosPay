// Passenger: home summary and savings, saved drop-offs, problem reports, routes, scan & pay, wallet and trip history.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { getUserPayment, startFarePayment, startTopup } from '../services/payments.js';
import { fileReport, REPORT_SELECT, reportSchema } from '../services/reports.js';
import { listRoutes, publicFareChanges } from '../services/routes.js';
import { getBalance } from '../services/wallet.js';
import { payFare, quoteFare, TRIP_SELECT } from '../services/trips.js';
import { nairobiDayRange, nairobiToday } from '../util.js';
import { id, kes, parse, phone } from '../validate.js';

const router = Router();

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
});
const page = (rows, limit) => ({ items: rows, next_before: rows.length === limit ? rows.at(-1).id : null });

// Passengers don't see the owner's payout details (or their own id/phone repeated on every trip).
const forPassenger = ({ passenger_phone, owner_phone, owner_name, passenger_id, payout_id, ...trip }) => trip;

// ---------- Home: balance, savings and favourite drop-offs ----------

// A drop-off stop with its route, as shown in "saved" and "frequent" lists. Only stops still in use.
const STOP_SELECT = `
  SELECT s.id AS stop_id, s.name AS stop_name, s.cash_fare, s.app_fare, s.cash_fare - s.app_fare AS you_save,
         r.id AS route_id, r.name AS route_name, r.origin
  FROM route_stops s JOIN routes r ON r.id = s.route_id
  WHERE s.is_active = 1 AND r.is_active = 1`;

/**
 * Everything the home screen shows, worked out here from verified payments (refunded fares don't count).
 * "Saved" is the cash fare minus what was paid, at the fares in force when each trip was paid.
 */
router.get('/summary', (req, res) => {
  const userId = req.user.id;
  const monthStart = nairobiDayRange(`${nairobiToday().slice(0, 7)}-01`)[0];
  const totals = (from) =>
    db
      .prepare(
        "SELECT COUNT(*) AS trips, COALESCE(SUM(cash_fare - fare), 0) AS saved, COALESCE(SUM(fare), 0) AS spent FROM trips WHERE passenger_id = ? AND status = 'paid' AND created_at >= ?",
      )
      .get(userId, from);
  const joined = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId).created_at;
  res.json({
    sacco_name: config.saccoName,
    balance: getBalance(userId),
    this_month: totals(monthStart),
    since_joining: { ...totals('0000'), joined_at: joined },
    // The drop-offs this passenger pays to most, for one-tap choosing.
    frequent: db
      .prepare(
        `${STOP_SELECT} AND s.id IN (
           SELECT stop_id FROM trips WHERE passenger_id = ? AND status = 'paid' AND stop_id IS NOT NULL
           GROUP BY stop_id ORDER BY COUNT(*) DESC, MAX(id) DESC LIMIT 3)`,
      )
      .all(userId),
    saved: db.prepare(`${STOP_SELECT} AND s.id IN (SELECT stop_id FROM saved_stops WHERE user_id = ?) ORDER BY r.name, s.position`).all(userId),
  });
});

router.post('/saved-stops', (req, res) => {
  const { stop_id } = parse(z.object({ stop_id: id }), req.body);
  if (!db.prepare(`${STOP_SELECT} AND s.id = ?`).get(stop_id)) throw new HttpError(404, 'NOT_FOUND', 'Stop not found');
  const count = db.prepare('SELECT COUNT(*) AS n FROM saved_stops WHERE user_id = ?').get(req.user.id).n;
  if (count >= 20) throw new HttpError(400, 'TOO_MANY_SAVED', 'You can save up to 20 drop-offs');
  db.prepare('INSERT OR IGNORE INTO saved_stops (user_id, stop_id) VALUES (?, ?)').run(req.user.id, stop_id);
  res.status(201).json({ ok: true });
});

router.delete('/saved-stops/:stopId', (req, res) => {
  db.prepare('DELETE FROM saved_stops WHERE user_id = ? AND stop_id = ?').run(req.user.id, parse(id, req.params.stopId));
  res.json({ ok: true });
});

// ---------- Problem reports ----------

router.post('/reports', (req, res) => {
  res.status(201).json(fileReport(req.user, parse(reportSchema, req.body)));
});

router.get('/reports', (req, res) => {
  const rows = db.prepare(`${REPORT_SELECT} WHERE r.reporter_id = ? ORDER BY r.id DESC LIMIT 50`).all(req.user.id);
  res.json(rows.map(({ reporter_phone, handled_by, ...r }) => r));
});

// Fare changes on routes in use: recent ones (last 30 days) and those coming up, with their dates.
router.get('/fare-changes', (_req, res) => {
  res.json(publicFareChanges());
});

// ---------- Routes, scanning and paying ----------

// Routes in use, each with its drop-off stops and fares, for the passenger to choose where they're going.
router.get('/routes', (_req, res) => {
  res.json(listRoutes({ activeOnly: true }).map(({ id: routeId, name, origin, stops }) => ({ id: routeId, name, origin, stops })));
});

// Step 1 of paying: the app sends whatever text it scanned from the QR sticker, and the chosen drop-off.
router.get('/scan', (req, res) => {
  const { qr, stop_id } = parse(z.object({ qr: z.string().min(1), stop_id: id.optional() }), req.query);
  res.json(quoteFare(req.user.id, qr, stop_id));
});

// Step 2: the passenger confirms. idempotency_key is a new random id from the app for each confirmation.
router.post('/pay', (req, res) => {
  const body = parse(
    z.object({ qr: z.string().min(1), stop_id: id, expected_fare: kes, idempotency_key: z.string().min(8).max(100) }),
    req.body,
  );
  const { trip, replayed } = payFare({
    passengerId: req.user.id,
    qr: body.qr,
    stopId: body.stop_id,
    expectedFare: body.expected_fare,
    idempotencyKey: body.idempotency_key,
  });
  res.status(replayed ? 200 : 201).json({ trip: forPassenger(trip), wallet_balance: getBalance(req.user.id) });
});

// Wallet too low: pay this one fare with an M-Pesa PIN prompt. The app then checks GET /mpesa/:id until confirmed.
router.post('/pay-mpesa', async (req, res) => {
  const body = parse(
    z.object({ qr: z.string().min(1), stop_id: id, expected_fare: kes, idempotency_key: z.string().min(8).max(100) }),
    req.body,
  );
  const result = await startFarePayment(req.user.id, {
    qr: body.qr,
    stopId: body.stop_id,
    expectedFare: body.expected_fare,
    idempotencyKey: body.idempotency_key,
    phone: req.user.phone,
  });
  const balance = getBalance(req.user.id);
  if (result.trip) return res.json({ trip: forPassenger(result.trip), wallet_balance: balance });
  res.status(202).json({ payment: result.payment, wallet_balance: balance });
});

router.get('/wallet', (req, res) => {
  res.json({ balance: getBalance(req.user.id), min_topup: config.minTopup, max_topup: config.maxTopup });
});

// Sends the M-Pesa PIN prompt. The app then checks GET /mpesa/:id until it is completed or failed.
router.post('/wallet/topup', async (req, res) => {
  const body = parse(z.object({ amount: kes, phone: phone.optional() }), req.body);
  const payment = await startTopup(req.user.id, { amount: body.amount, phone: body.phone ?? req.user.phone });
  res.status(202).json({ payment, wallet_balance: getBalance(req.user.id) });
});

// M-Pesa payments that are still waiting or didn't go through, so the wallet can explain them.
// (Successful ones are already in the wallet history.) Only the last 30 days.
router.get('/mpesa', (req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  res.json(
    db
      .prepare(
        `SELECT id, amount, purpose, status, result_desc, mpesa_receipt, created_at, completed_at FROM mpesa_payments
         WHERE user_id = ? AND status != 'completed' AND created_at >= ? ORDER BY id DESC LIMIT 20`,
      )
      .all(req.user.id, since),
  );
});

// Status of a top-up or M-Pesa fare payment (asks M-Pesa if still pending). Includes the ticket once a fare is paid.
router.get('/mpesa/:id', async (req, res) => {
  const { payment, trip } = await getUserPayment(req.user.id, parse(id, req.params.id));
  res.json({ payment, trip: trip && forPassenger(trip), wallet_balance: getBalance(req.user.id) });
});

router.get('/wallet/transactions', (req, res) => {
  const { limit, before } = parse(pagination, req.query);
  const rows = db
    .prepare('SELECT * FROM wallet_transactions WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
    .all(req.user.id, before ?? Number.MAX_SAFE_INTEGER, limit);
  res.json(page(rows, limit));
});

router.get('/trips', (req, res) => {
  const { limit, before } = parse(pagination, req.query);
  const rows = db
    .prepare(`${TRIP_SELECT} WHERE t.passenger_id = ? AND t.id < ? ORDER BY t.id DESC LIMIT ?`)
    .all(req.user.id, before ?? Number.MAX_SAFE_INTEGER, limit);
  res.json(page(rows.map(forPassenger), limit));
});

export default router;
