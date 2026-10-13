// The website's seat booking (/book-api). Nobody signs in: the M-Pesa PIN prompt proves who is paying, and the
// booking link (a signed token) is what the passenger keeps.
import { Router } from 'express';
import { z } from 'zod';
import { noAppPromptsByIp, noAppPromptsByPhone } from '../ratelimit.js';
import { bookingStatusByToken, cancelBooking, MAX_SEATS_PER_BOOKING, routesForBooking, startBooking } from '../services/bookings.js';
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

export default router;
