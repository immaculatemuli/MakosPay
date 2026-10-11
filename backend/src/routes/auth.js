import { Router } from 'express';
import { z } from 'zod';
import { authenticate, signToken } from '../auth.js';
import { changePassword, createUser, deleteOwnAccount, verifyCredentials } from '../services/users.js';
import { name, parse, password, phone } from '../validate.js';

const router = Router();

// Only passengers sign up themselves. Everyone else is created by the SACCO office.
router.post('/register', async (req, res) => {
  const body = parse(z.object({ name, phone, password }), req.body);
  const user = await createUser({ ...body, role: 'passenger' });
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', async (req, res) => {
  const body = parse(z.object({ phone, password: z.string().min(1) }), req.body);
  const user = await verifyCredentials(body.phone, body.password);
  res.json({ token: signToken(user), user });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Passengers can delete their own account (Google Play requires this for apps with sign-up).
router.post('/delete-account', authenticate, async (req, res) => {
  const { password: current } = parse(z.object({ password: z.string().min(1) }), req.body);
  await deleteOwnAccount(req.user.id, current);
  res.json({ ok: true });
});

router.post('/change-password', authenticate, async (req, res) => {
  const body = parse(z.object({ current_password: z.string().min(1), new_password: password }), req.body);
  await changePassword(req.user.id, body.current_password, body.new_password);
  res.json({ ok: true });
});

export default router;
