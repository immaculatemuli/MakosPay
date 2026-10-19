// Africa's Talking calls this for every USSD key press: POST /ussd/<secret> with sessionId, serviceCode, phoneNumber
// and text (everything typed so far). The answer is plain text: "CON ..." (next screen) or "END ..." (last one).
// Africa's Talking doesn't sign its requests, so the address carries a secret only FarePay and Africa's Talking know.
import { timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import { config } from '../config.js';
import { ussdReply } from '../services/ussd.js';
import { normalizePhone } from '../util.js';

const router = Router();

const sameSecret = (given) => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(config.ussd.callbackSecret);
  return a.length === b.length && timingSafeEqual(a, b);
};

router.post('/:secret', express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
  if (!sameSecret(req.params.secret)) return res.status(404).type('text/plain').send('Not found');
  const phone = normalizePhone(String(req.body.phoneNumber ?? ''));
  const reply = phone
    ? await ussdReply({ sessionId: String(req.body.sessionId ?? ''), phone, text: String(req.body.text ?? '') })
    : 'END This service needs a Kenyan phone number.';
  res.type('text/plain').send(reply);
});

export default router;
