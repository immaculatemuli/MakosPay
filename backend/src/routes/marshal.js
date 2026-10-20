// Stage marshals: the queue of passengers who booked seats, cars arriving at the stage (filled from the queue, first
// booked first served), giving road pickups to cars, ticking passengers on, and cars leaving.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { notFound } from '../errors.js';
import { HttpError } from '../errors.js';
import { assignPickup, boardByCode, setCarFull, boardSeat, cancelSeat, carArrived, carLeft, marshalQueues, marshalVehicles } from '../services/seats.js';
import { parseQr } from '../util.js';
import { id, parse } from '../validate.js';

const router = Router();

router.get('/queues', async (_req, res) => {
  res.json(await marshalQueues());
});

// Vehicles to choose from when one arrives (?q= part of the plate).
router.get('/vehicles', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(20).default('') }), req.query);
  res.json(await marshalVehicles(q));
});

// A car reached the stage: it starts loading (on route_id if given) and takes the first passengers in the queue.
// The car is chosen from the list (vehicle_id) or by scanning the sticker inside it (qr).
router.post('/cars/arrived', async (req, res) => {
  const body = parse(z.object({ vehicle_id: id.optional(), qr: z.string().trim().min(1).max(500).optional(), route_id: id.optional() }), req.body);
  let vehicleId = body.vehicle_id;
  if (!vehicleId && body.qr) vehicleId = (await db.get('SELECT id FROM vehicles WHERE qr_token = ?', parseQr(body.qr)))?.id;
  if (!vehicleId) throw new HttpError(404, 'INVALID_QR', body.qr ? 'This is not the sticker of a FarePay car.' : 'Choose the car that arrived.');
  await carArrived(vehicleId, body.route_id ?? null, req.user.id);
  res.json(await marshalQueues());
});

// The car left the stage: passengers put on it who didn't board go back to the front of the queue.
router.post('/cars/:vehicleId/left', async (req, res) => {
  await carLeft(parse(id, req.params.vehicleId));
  res.json(await marshalQueues());
});

// The loading car is full (e.g. cash passengers filled it), or not full any more.
router.post('/cars/:vehicleId/full', async (req, res) => {
  const { full } = parse(z.object({ full: z.boolean() }), req.body);
  await setCarFull(parse(id, req.params.vehicleId), full);
  res.json(await marshalQueues());
});

// A road pickup goes to a car (loading, or on the road and not yet past the pickup point).
router.post('/seats/:id/assign', async (req, res) => {
  const body = parse(z.object({ load_id: id }), req.body);
  await assignPickup(parse(id, req.params.id), body.load_id);
  res.json(await marshalQueues());
});

// Boarding by scanning the passenger's booking QR (or typing its code): any car.
router.post('/seats/board-code', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(4).max(40) }), req.body);
  res.json(await boardByCode(code));
});

router.post('/seats/:id/board', async (req, res) => {
  await boardSeat(parse(id, req.params.id));
  res.json(await marshalQueues());
});

// e.g. the passenger asked, or never came: refunded (to M-Pesa if paid by M-Pesa).
router.post('/seats/:id/cancel', async (req, res) => {
  const bookingId = parse(id, req.params.id);
  const body = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  if (!(await db.get('SELECT 1 FROM seat_bookings WHERE id = ?', bookingId))) throw notFound('Booking');
  await cancelSeat(bookingId, { reason: body.reason, by: 'marshal' });
  res.json(await marshalQueues());
});

export default router;
