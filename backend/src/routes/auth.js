import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkWebRequest, clearOfficeCookie, OFFICE_ROLES, setOfficeCookie, signToken } from '../auth.js';
import { HttpError } from '../errors.js';
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

/** Checks phone and password. Only wrong passwords count towards the limits; a correct one clears the phone's count. */
async function signIn(req) {
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
  return user;
}

// The phone app: the token comes back in the answer and is kept in the phone's secure storage.
router.post('/login', async (req, res) => {
  const user = await signIn(req);
  res.json({ token: await signToken(user), user });
});

// The office web dashboard: the sign-in goes into an HttpOnly cookie (never in the answer). Office accounts only.
router.post('/web/login', async (req, res) => {
  checkWebRequest(req);
  const user = await signIn(req);
  if (!OFFICE_ROLES.includes(user.role)) throw new HttpError(403, 'OFFICE_ONLY', 'The web dashboard is for the SACCO office. Please use the FarePay app.');
  await setOfficeCookie(req, res, user);
  res.json({ user });
});

router.post('/web/logout', (req, res) => {
  checkWebRequest(req);
  clearOfficeCookie(req, res);
  res.json({ ok: true });
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

// Every other phone and browser is signed out; this one gets a new sign-in so it stays signed in.
router.post('/change-password', authenticate, limitBy(passwordChecksByUser, (req) => req.user.id), async (req, res) => {
  const body = parse(z.object({ current_password: z.string().min(1), new_password: password }), req.body);
  await changePassword(req.user.id, body.current_password, body.new_password);
  await audit(req.user, 'account.password_changed', 'users', req.user.id);
  if (req.signedInWith === 'web') {
    await setOfficeCookie(req, res, req.user);
    return res.json({ ok: true, user: req.user });
  }
  res.json({ ok: true, token: await signToken(req.user), user: req.user });
});

export default router;
