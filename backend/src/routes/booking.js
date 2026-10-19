// The website's seat booking and parcel tracking (/book-api). Nobody signs in: the M-Pesa PIN prompt proves who is paying, and the
// booking link (a signed token) is what the passenger keeps.
import { Router } from 'express';
import { z } from 'zod';
import { limitBy, limiter, noAppPromptsByIp, noAppPromptsByPhone } from '../ratelimit.js';
import { bookingStatusByToken, cancelBooking, MAX_SEATS_PER_BOOKING, routesForBooking, startBooking } from '../services/bookings.js';
import { trackParcel } from '../services/parcels.js';
import { passengerFor } from '../services/noapp.js';
import { bookSeats, cancelSeat, MAX_SEATS, passengerHere, seatIdFromToken, seatRoutes, seatToken, seatView } from '../services/seats.js';

const trackingByIp = limiter({ windowMs: 10 * 60_000, max: 60, message: (m) => `Too many look-ups. Try again in ${m} minute${m === 1 ? '' : 's'}.` });
import { id, kes, parse, phone } from '../validate.js';

const router = Router();

router.get('/routes', async (_req, res) => {
  res.json(await routesForBooking());
});

router.post('/bookings', async (req, res) => {
  const body = parse(
    z.object({
      route_id: id,
      stop_id: id,
      seats: z.number().int().min(1).max(MAX_SEATS_PER_BOOKING),
      expected_fare: kes,
      phone,
      idempotency_key: z.string().min(8).max(100),
    }),
    req.body,
  );
  noAppPromptsByIp.hit(req.ip);
  noAppPromptsByPhone.hit(body.phone);
  res.status(202).json(
    await startBooking({
      routeId: body.route_id,
      stopId: body.stop_id,
      seats: body.seats,
      expectedFare: body.expected_fare,
      phone: body.phone,
      idempotencyKey: body.idempotency_key,
    }),
  );
});

router.get('/bookings/:token', async (req, res) => {
  res.json(await bookingStatusByToken(req.params.token));
});

router.post('/bookings/:token/cancel', async (req, res) => {
  res.json(await cancelBooking(req.params.token));
});

// ---------- Seat booking from anywhere (the stage queue) ----------

router.get('/seat-routes', async (_req, res) => {
  res.json(await seatRoutes());
});

// Paid by M-Pesa PIN prompt to the number given; the answer carries the booking's link (token).
router.post('/seats', async (req, res) => {
  const body = parse(
    z.object({
      route_id: id,
      pickup_stop_id: id.nullable().default(null),
      // Booking for later: when they will be ready (ISO time, today or tomorrow); null = now.
      ready_at: z.string().max(40).nullable().default(null),
      stop_id: id,
      seats: z.number().int().min(1).max(MAX_SEATS),
      expected_fare: kes,
      phone,
      idempotency_key: z.string().min(8).max(100),
    }),
    req.body,
  );
  noAppPromptsByIp.hit(req.ip);
  noAppPromptsByPhone.hit(body.phone);
  const booking = await bookSeats({
    passengerId: await passengerFor(body.phone),
    phone: body.phone,
    routeId: body.route_id,
    pickupStopId: body.pickup_stop_id,
    readyAt: body.ready_at,
    stopId: body.stop_id,
    seats: body.seats,
    expectedFare: body.expected_fare,
    idempotencyKey: body.idempotency_key,
    payWith: 'mpesa',
  });
  res.status(202).json({ ...booking, token: seatToken(booking.id) });
});

router.get('/seats/:token', async (req, res) => {
  res.json(await seatView(seatIdFromToken(req.params.token)));
});

router.post('/seats/:token/cancel', async (req, res) => {
  res.json(await cancelSeat(seatIdFromToken(req.params.token), { reason: 'Cancelled by you', by: 'passenger' }));
});

router.post('/seats/:token/here', async (req, res) => {
  res.json(await passengerHere(seatIdFromToken(req.params.token)));
});

// Parcel tracking by its code (no names in full, phone numbers, fee or collection code). Limited per network
// address so codes can't be guessed by trying many.
router.get('/parcels/:code', limitBy(trackingByIp, (req) => req.ip), async (req, res) => {
  res.json(await trackParcel(req.params.code));
});

export default router;
