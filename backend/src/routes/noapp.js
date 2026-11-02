// The pay page for passengers without the app (/pay?v=<sticker token>), and the three calls it makes.
// Nobody signs in here: the sticker says which vehicle, M-Pesa's PIN prompt proves who is paying.
import express, { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { noAppPromptsByIp, noAppPromptsByPhone } from '../ratelimit.js';
import { noAppPaymentByToken, startNoAppFare, vehicleForPayPage } from '../services/noapp.js';
import { id, kes, parse, phone } from '../validate.js';

const PAGE_DIR = fileURLToPath(new URL('../web/pay/', import.meta.url));

// The page may only load its own script and style and talk to FarePay.
const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const pageCsp = (_req, res, next) => {
  res.set('Content-Security-Policy', PAGE_CSP);
  next();
};

export const payPage = Router();
payPage.get('/pay', pageCsp, (_req, res) => res.sendFile(`${PAGE_DIR}index.html`));
payPage.use('/pay-assets', pageCsp, express.static(PAGE_DIR, { index: false, redirect: false }));

export const payApi = Router();

payApi.get('/vehicle', async (req, res) => {
  const { qr } = parse(z.object({ qr: z.string().min(1).max(500) }), req.query);
  res.json(await vehicleForPayPage(qr));
});

payApi.post('/pay', async (req, res) => {
  const body = parse(
    z.object({ qr: z.string().min(1).max(500), stop_id: id, expected_fare: kes, phone, idempotency_key: z.string().min(8).max(100) }),
    req.body,
  );
  noAppPromptsByIp.hit(req.ip);
  noAppPromptsByPhone.hit(body.phone);
  res.status(202).json(
    await startNoAppFare({ qr: body.qr, stopId: body.stop_id, expectedFare: body.expected_fare, phone: body.phone, idempotencyKey: body.idempotency_key }),
  );
});

payApi.get('/payment/:token', async (req, res) => {
  res.json(await noAppPaymentByToken(req.params.token));
});
