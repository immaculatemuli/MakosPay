// Platform admin (whoever runs FarePay itself): how the system is set up, and the platform admin accounts.
// Platform admins can also use every SACCO office screen (see app.js).
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import * as mpesa from '../services/mpesa.js';
import { createUser } from '../services/users.js';
import { id, name, parse, password, phone } from '../validate.js';

const router = Router();

// How money moves right now. `live` is true only when real money moves (Safaricom production or IntaSend live).
router.get('/system', (_req, res) => {
  const live = config.paymentProvider === 'intasend' ? config.intasend.mode === 'live' : config.mpesa.mode === 'production';
  res.json({
    payments_by: mpesa.providerLabel,
    live,
    mpesa_payments_enabled: mpesa.isConfigured.stk,
    automatic_payouts_enabled: mpesa.isConfigured.b2c,
    daily_payout_at: config.payoutDailyAt,
    wallet_limits: { min_topup: config.minTopup, max_topup: config.maxTopup, max_balance: config.maxWalletBalance },
    counts: db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM users WHERE role = 'passenger') AS passengers,
                (SELECT COUNT(*) FROM users WHERE role IN ('conductor', 'driver')) AS crew,
                (SELECT COUNT(*) FROM users WHERE role IN ('admin', 'platform_admin')) AS office,
                (SELECT COUNT(*) FROM vehicles WHERE is_active = 1) AS vehicles`,
      )
      .get(),
  });
});

const PLATFORM_SELECT = "SELECT id, name, phone, is_active, created_at FROM users WHERE role = 'platform_admin'";

router.get('/admins', (_req, res) => {
  res.json(db.prepare(`${PLATFORM_SELECT} ORDER BY is_active DESC, name`).all());
});

router.post('/admins', async (req, res) => {
  const body = parse(z.object({ name, phone, password }), req.body);
  res.status(201).json(await createUser({ ...body, role: 'platform_admin' }));
});

// Nobody can switch off their own account, so there is always a platform admin who can sign in.
router.patch('/admins/:id', (req, res) => {
  const adminId = parse(id, req.params.id);
  const { is_active } = parse(z.object({ is_active: z.boolean() }), req.body);
  if (adminId === req.user.id && !is_active) throw new HttpError(400, 'CANNOT_DISABLE_SELF', 'You cannot switch off your own account');
  const result = db.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role = 'platform_admin'").run(Number(is_active), adminId);
  if (result.changes === 0) throw notFound('Platform admin');
  res.json(db.prepare(`${PLATFORM_SELECT} AND id = ?`).get(adminId));
});

export default router;
