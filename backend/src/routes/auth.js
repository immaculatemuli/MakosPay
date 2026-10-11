import { Router } from 'express';
import { z } from 'zod';
import { authenticate, signToken } from '../auth.js';
import { limitBy, passwordChecksByUser, signUpByIp, wrongPasswordByIp, wrongPasswordByPhone } from '../ratelimit.js';
import { audit } from '../services/audit.js';
import { changePassword, createUser, deleteOwnAccount, verifyCredentials } from '../services/users.js';
import { name, parse, password, phone } from '../validate.js';

const router = Router();

// Only passengers sign up themselves. Everyone else is created by the SACCO office.
router.post('/register', async (req, res) => {
  const body = parse(z.object({ name, phone, password }), req.body);
  signUpByIp.hit(req.ip);
  const user = await createUser({ ...body, role: 'passenger' });
  res.status(201).json({ token: await signToken(user), user });
});

// Only wrong passwords count towards the limits; signing in successfully clears the phone's count.
router.post('/login', async (req, res) => {
  const body = parse(z.object({ phone, password: z.string().min(1) }), req.body);
  wrongPasswordByPhone.check(body.phone);
  wrongPasswordByIp.check(req.ip);
  let user;
  try {
    user = await verifyCredentials(body.phone, body.password);
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') {
      wrongPasswordByPhone.record(body.phone);
      wrongPasswordByIp.record(req.ip);
    }
    throw err;
  }
  wrongPasswordByPhone.reset(body.phone);
  res.json({ token: await signToken(user), user });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Passengers can delete their own account (Google Play requires this for apps with sign-up).
router.post('/delete-account', authenticate, limitBy(passwordChecksByUser, (req) => req.user.id), async (req, res) => {
  const { password: current } = parse(z.object({ password: z.string().min(1) }), req.body);
  await deleteOwnAccount(req.user.id, current);
  await audit(req.user, 'account.delete', 'users', req.user.id);
  res.json({ ok: true });
});

// Every other phone is signed out; this one gets a new sign-in so it stays signed in.
router.post('/change-password', authenticate, limitBy(passwordChecksByUser, (req) => req.user.id), async (req, res) => {
  const body = parse(z.object({ current_password: z.string().min(1), new_password: password }), req.body);
  await changePassword(req.user.id, body.current_password, body.new_password);
  await audit(req.user, 'account.password_changed', 'users', req.user.id);
  res.json({ ok: true, token: await signToken(req.user), user: req.user });
});

export default router;
