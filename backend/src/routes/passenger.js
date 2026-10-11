// Passenger: routes to choose from, scan & pay, wallet and trip history.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { getUserPayment, startFarePayment, startTopup } from '../services/payments.js';
import { listRoutes } from '../services/routes.js';
import { getBalance } from '../services/wallet.js';
import { payFare, quoteFare, TRIP_SELECT } from '../services/trips.js';
import { id, kes, parse, phone } from '../validate.js';

const router = Router();

const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.number().int().positive().optional(),
});
const page = (rows, limit) => ({ items: rows, next_before: rows.length === limit ? rows.at(-1).id : null });

// Passengers don't see the owner's payout details (or their own id/phone repeated on every trip).
const forPassenger = ({ passenger_phone, owner_phone, owner_name, passenger_id, payout_id, ...trip }) => trip;

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
