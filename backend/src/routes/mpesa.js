// Safaricom calls these to confirm payments. They can't log in, so the URL carries a secret.
// Always answer "Accepted"; problems are logged and the background check confirms the payment anyway.
import { Router } from 'express';
import { config } from '../config.js';
import { handleStkCallback } from '../services/payments.js';
import { handleB2cResult, handleB2cTimeout } from '../services/payouts.js';
import { safeEqual } from '../util.js';

const router = Router();

const accept = (handler) => (req, res) => {
  if (!safeEqual(req.params.secret, config.mpesa.callbackSecret)) return res.status(404).end();
  try {
    handler(req.body);
  } catch (err) {
    console.error('[mpesa] callback processing failed', err, JSON.stringify(req.body));
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
};

router.post('/callback/:secret/stk', accept(handleStkCallback)); // passenger payments
router.post('/callback/:secret/b2c/result', accept(handleB2cResult)); // owner payouts
router.post('/callback/:secret/b2c/timeout', accept(handleB2cTimeout));
router.post('/callback/:secret/b2b/result', accept(handleB2cResult)); // owner payouts to bank accounts
router.post('/callback/:secret/b2b/timeout', accept(handleB2cTimeout));

export default router;
