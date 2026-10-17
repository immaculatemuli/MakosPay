// Passenger: home summary, saved drop-offs, problem reports, routes, scan & pay, seat booking, wallet and trip history.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { limitBy, pinPromptsByUser } from '../ratelimit.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { cancelPassengerBooking, MAX_SEATS_PER_BOOKING, passengerBooking, passengerBookings, routesForBooking, startBooking } from '../services/bookings.js';
import { getUserPayment, startFarePayment, startTopup } from '../services/payments.js';
import { bookSeats, cancelSeat, MAX_SEATS, mySeat, mySeats, passengerHere, seatRoutes } from '../services/seats.js';
import { fileReport, getPhoto, myReports, replySchema, reporterReply, reportSchema, sendPhoto } from '../services/reports.js';
import { listRoutes, publicFareChanges } from '../services/routes.js';
import { getBalance } from '../services/wallet.js';
import { requestWithdrawal } from '../services/withdrawals.js';
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
  WHERE s.is_active = TRUE AND r.is_active = TRUE`;

// Before any FarePay payment could exist, for "since joining" totals.
const BEGINNING = '1970-01-01T00:00:00.000Z';

/**
 * Everything the home screen shows, worked out here from verified payments (refunded fares don't count).
 * "Saved" is the cash fare minus what was paid, at the fares in force when each trip was paid.
 */
router.get('/summary', async (req, res) => {
  const userId = req.user.id;
  const monthStart = nairobiDayRange(`${nairobiToday().slice(0, 7)}-01`)[0];
  const totals = (from) =>
    db.get(
      "SELECT COUNT(*) AS trips, COALESCE(SUM(cash_fare - fare), 0) AS saved, COALESCE(SUM(fare), 0) AS spent FROM trips WHERE passenger_id = ? AND status = 'paid' AND created_at >= ?",
      userId,
      from,
    );
  const joined = (await db.get('SELECT created_at FROM users WHERE id = ?', userId)).created_at;
  res.json({
    sacco_name: config.saccoName,
    balance: await getBalance(userId),
    this_month: await totals(monthStart),
    since_joining: { ...(await totals(BEGINNING)), joined_at: joined },
    // The drop-offs this passenger pays to most, for one-tap choosing.
    frequent: await db.all(
      `${STOP_SELECT} AND s.id IN (
         SELECT stop_id FROM trips WHERE passenger_id = ? AND status = 'paid' AND stop_id IS NOT NULL
         GROUP BY stop_id ORDER BY COUNT(*) DESC, MAX(id) DESC LIMIT 3)`,
      userId,
    ),
    saved: await db.all(`${STOP_SELECT} AND s.id IN (SELECT stop_id FROM saved_stops WHERE user_id = ?) ORDER BY r.name, s.position`, userId),
  });
});

router.post('/saved-stops', async (req, res) => {
  const { stop_id } = parse(z.object({ stop_id: id }), req.body);
  if (!(await db.get(`${STOP_SELECT} AND s.id = ?`, stop_id))) throw new HttpError(404, 'NOT_FOUND', 'Stop not found');
  const count = (await db.get('SELECT COUNT(*) AS n FROM saved_stops WHERE user_id = ?', req.user.id)).n;
  if (count >= 20) throw new HttpError(400, 'TOO_MANY_SAVED', 'You can save up to 20 drop-offs');
  await db.run('INSERT INTO saved_stops (user_id, stop_id) VALUES (?, ?) ON CONFLICT DO NOTHING', req.user.id, stop_id);
  res.status(201).json({ ok: true });
});

router.delete('/saved-stops/:stopId', async (req, res) => {
  await db.run('DELETE FROM saved_stops WHERE user_id = ? AND stop_id = ?', req.user.id, parse(id, req.params.stopId));
  res.json({ ok: true });
});

// ---------- Problem reports ----------

router.post('/reports', async (req, res) => {
  res.status(201).json(await fileReport(req.user, parse(reportSchema, req.body)));
});

router.get('/reports', async (req, res) => {
  res.json(await myReports(req.user.id));
});

// A photo on one of your own reports.
router.get('/reports/:id/photos/:photoId', async (req, res) => {
  const photo = await getPhoto(parse(id, req.params.id), parse(id, req.params.photoId), { reporterId: req.user.id });
  sendPhoto(res, photo);
});

// Writing more on one of your own reports (opens it again if it was resolved).
router.post('/reports/:id/messages', async (req, res) => {
  res.status(201).json(await reporterReply(req.user, parse(id, req.params.id), parse(replySchema, req.body)));
});

// Fare changes on routes in use: recent ones (last 30 days) and those coming up, with their dates.
router.get('/fare-changes', async (_req, res) => {
  res.json(await publicFareChanges());
});

// ---------- Routes, scanning and paying ----------

// Routes in use, each with its drop-off stops and fares, for the passenger to choose where they're going.
router.get('/routes', async (_req, res) => {
  res.json((await listRoutes({ activeOnly: true })).map(({ id: routeId, name, origin, stops }) => ({ id: routeId, name, origin, stops })));
});

// Step 1 of paying: the app sends whatever text it scanned from the QR sticker, and the chosen drop-off.
router.get('/scan', async (req, res) => {
  const { qr, stop_id } = parse(z.object({ qr: z.string().min(1), stop_id: id.optional() }), req.query);
  res.json(await quoteFare(req.user.id, qr, stop_id));
});

// Step 2: the passenger confirms. idempotency_key is a new random id from the app for each confirmation.
router.post('/pay', async (req, res) => {
  const body = parse(
    z.object({ qr: z.string().min(1), stop_id: id, expected_fare: kes, idempotency_key: z.string().min(8).max(100) }),
    req.body,
  );
  const { trip, replayed } = await payFare({
    passengerId: req.user.id,
    qr: body.qr,
    stopId: body.stop_id,
    expectedFare: body.expected_fare,
    idempotencyKey: body.idempotency_key,
  });
  res.status(replayed ? 200 : 201).json({ trip: forPassenger(trip), wallet_balance: await getBalance(req.user.id) });
});

// Wallet too low: pay this one fare with an M-Pesa PIN prompt. The app then checks GET /mpesa/:id until confirmed.
router.post('/pay-mpesa', limitBy(pinPromptsByUser, (req) => req.user.id), async (req, res) => {
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
  const balance = await getBalance(req.user.id);
  if (result.trip) return res.json({ trip: forPassenger(result.trip), wallet_balance: balance });
  res.status(202).json({ payment: result.payment, wallet_balance: balance });
});

// ---------- Seat booking on the car loading at the stage ----------

router.get('/booking-routes', async (_req, res) => {
  res.json(await routesForBooking());
});

router.get('/bookings', async (req, res) => {
  res.json(await passengerBookings(req.user.id));
});

// Pay from the wallet at once, or by M-Pesa PIN prompt to the passenger's own number.
router.post('/bookings', async (req, res) => {
  const body = parse(
    z.object({
      route_id: id,
      stop_id: id,
      seats: z.number().int().min(1).max(MAX_SEATS_PER_BOOKING),
      expected_fare: kes,
      idempotency_key: z.string().min(8).max(100),
      pay_with: z.enum(['wallet', 'mpesa']),
    }),
    req.body,
  );
  if (body.pay_with === 'mpesa') pinPromptsByUser.hit(req.user.id);
  const booking = await startBooking({
    routeId: body.route_id,
    stopId: body.stop_id,
    seats: body.seats,
    expectedFare: body.expected_fare,
    idempotencyKey: body.idempotency_key,
    phone: req.user.phone,
    passengerId: req.user.id,
    payWith: body.pay_with,
  });
  res.status(201).json({ ...booking, wallet_balance: await getBalance(req.user.id) });
});

router.get('/bookings/:id', async (req, res) => {
  res.json(await passengerBooking(req.user.id, parse(id, req.params.id)));
});

router.post('/bookings/:id/cancel', async (req, res) => {
  res.json(await cancelPassengerBooking(req.user.id, parse(id, req.params.id)));
});

// ---------- Seat booking from anywhere (the stage queue) ----------

router.get('/seat-routes', async (_req, res) => {
  res.json(await seatRoutes());
});

router.get('/seats', async (req, res) => {
  res.json(await mySeats(req.user.id));
});

// Book seats to a drop-off, picked at the stage (pickup_stop_id null) or on the road; paid by M-Pesa or the wallet.
router.post('/seats', async (req, res) => {
  const body = parse(
    z.object({
      route_id: id,
      pickup_stop_id: id.nullable().default(null),
      stop_id: id,
      seats: z.number().int().min(1).max(MAX_SEATS),
      expected_fare: kes,
      idempotency_key: z.string().min(8).max(100),
      pay_with: z.enum(['wallet', 'mpesa']),
    }),
    req.body,
  );
  if (body.pay_with === 'mpesa') pinPromptsByUser.hit(req.user.id);
  const booking = await bookSeats({
    passengerId: req.user.id,
    phone: req.user.phone,
    routeId: body.route_id,
    pickupStopId: body.pickup_stop_id,
    stopId: body.stop_id,
    seats: body.seats,
    expectedFare: body.expected_fare,
    idempotencyKey: body.idempotency_key,
    payWith: body.pay_with,
  });
  res.status(201).json({ ...booking, wallet_balance: await getBalance(req.user.id) });
});

router.get('/seats/:id', async (req, res) => {
  res.json(await mySeat(req.user.id, parse(id, req.params.id)));
});

router.post('/seats/:id/cancel', async (req, res) => {
  const seat = await mySeat(req.user.id, parse(id, req.params.id));
  res.json(await cancelSeat(seat.id, { reason: 'Cancelled by you', by: 'passenger' }));
});

// "I'm at the pickup point": the car's crew (or the marshal) are told.
router.post('/seats/:id/here', async (req, res) => {
  const seat = await mySeat(req.user.id, parse(id, req.params.id));
  res.json(await passengerHere(seat.id));
});

router.get('/wallet', async (req, res) => {
  res.json({ balance: await getBalance(req.user.id), min_topup: config.minTopup, max_topup: config.maxTopup });
});

// Sends the M-Pesa PIN prompt. The app then checks GET /mpesa/:id until it is completed or failed.
router.post('/wallet/topup', limitBy(pinPromptsByUser, (req) => req.user.id), async (req, res) => {
  const body = parse(z.object({ amount: kes, phone: phone.optional() }), req.body);
  const payment = await startTopup(req.user.id, { amount: body.amount, phone: body.phone ?? req.user.phone });
  res.status(202).json({ payment, wallet_balance: await getBalance(req.user.id) });
});

// Withdrawals: wallet money back to the passenger's own M-Pesa number (never another number).
router.get('/withdrawals', async (req, res) => {
  const rows = await db.all(
    'SELECT id, phone, amount, status, reference, result_desc, created_at, completed_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 20',
    req.user.id,
  );
  res.json({ balance: await getBalance(req.user.id), phone: req.user.phone, min_amount: config.minWithdrawal, per_day: config.maxWithdrawalsPerDay, withdrawals: rows });
});

router.post('/withdrawals', async (req, res) => {
  const { amount } = parse(z.object({ amount: kes }), req.body);
  const withdrawal = await requestWithdrawal(req.user, amount);
  const { passenger_name, handled_by, handled_by_name, conversation_id, provider_reference, ...mine } = withdrawal;
  res.status(201).json({ withdrawal: mine, balance: await getBalance(req.user.id) });
});

// M-Pesa payments that are still waiting or didn't go through, so the wallet can explain them.
// (Successful ones are already in the wallet history.) Only the last 30 days.
router.get('/mpesa', async (req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  res.json(
    await db.all(
      `SELECT id, amount, purpose, status, result_desc, mpesa_receipt, created_at, completed_at FROM mpesa_payments
       WHERE user_id = ? AND status != 'completed' AND created_at >= ? ORDER BY id DESC LIMIT 20`,
      req.user.id,
      since,
    ),
  );
});

// Status of a top-up or M-Pesa fare payment (asks M-Pesa if still pending). Includes the ticket once a fare is paid.
router.get('/mpesa/:id', async (req, res) => {
  const { payment, trip } = await getUserPayment(req.user.id, parse(id, req.params.id));
  res.json({ payment, trip: trip && forPassenger(trip), wallet_balance: await getBalance(req.user.id) });
});

router.get('/wallet/transactions', async (req, res) => {
  const { limit, before } = parse(pagination, req.query);
  const rows = await db.all(
    'SELECT * FROM wallet_transactions WHERE user_id = ? AND (CAST(? AS INTEGER) IS NULL OR id < ?) ORDER BY id DESC LIMIT ?',
    req.user.id,
    before ?? null,
    before ?? null,
    limit,
  );
  res.json(page(rows, limit));
});

router.get('/trips', async (req, res) => {
  const { limit, before } = parse(pagination, req.query);
  const rows = await db.all(
    `${TRIP_SELECT} WHERE t.passenger_id = ? AND (CAST(? AS INTEGER) IS NULL OR t.id < ?) ORDER BY t.id DESC LIMIT ?`,
    req.user.id,
    before ?? null,
    before ?? null,
    limit,
  );
  res.json(page(rows.map(forPassenger), limit));
});

export default router;
