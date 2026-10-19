import { Router } from 'express';
import { z } from 'zod';
import { authenticate, checkWebRequest, clearOfficeCookie, OFFICE_ROLES, setOfficeCookie, signToken } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { limitBy, passwordChecksByUser, signUpByIp, wrongPasswordByIp, wrongPasswordByPhone } from '../ratelimit.js';
import { audit } from '../services/audit.js';
import { confirmReset, requestReset } from '../services/passwordReset.js';
import { checkPhoneFree, sendSignupCode, signupCodeNeeded, useSignupCode } from '../services/signupCodes.js';
import { changePassword, createUser, deleteOwnAccount, renameSelf, verifyCredentials } from '../services/users.js';
import { name, parse, password, phone } from '../validate.js';

const router = Router();

// Only passengers sign up themselves. Everyone else is created by the SACCO office.
// Step 1: a 6-digit code by SMS to the number, proving it is theirs ({ code_needed: false } when the server has no SMS).
router.post('/register/code', async (req, res) => {
  const body = parse(z.object({ phone }), req.body);
  res.json(await sendSignupCode(body.phone, req.ip));
});

// Step 2: the account, with the code.
router.post('/register', async (req, res) => {
  const body = parse(z.object({ name, phone, password, code: z.string().trim().regex(/^\d{6}$/, 'The 6-digit code from the SMS').optional() }), req.body);
  signUpByIp.hit(req.ip);
  const proven = signupCodeNeeded();
  await checkPhoneFree(body.phone, { proven });
  if (proven) await useSignupCode(body.phone, body.code);
  const user = await createUser({ name: body.name, phone: body.phone, password: body.password, role: 'passenger', takeOverNoApp: proven });
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
  res.json({ user, sacco_name: config.saccoName });
});

// Who is signed in on this browser, if anyone: { user } or { user: null }. (Not an error when nobody is, so
// opening the dashboard before signing in leaves no errors in the browser.)
router.get('/web/session', async (req, res) => {
  try {
    await authenticate(req, res, () => {});
  } catch (err) {
    if (err.status === 401) return res.json({ user: null });
    throw err;
  }
  res.json({ user: req.user, sacco_name: config.saccoName });
});

router.post('/web/logout', (req, res) => {
  checkWebRequest(req);
  clearOfficeCookie(req, res);
  res.json({ ok: true });
});

// Forgot password: a code by SMS, then a new password with it. Works for every kind of account; for a passenger
// who has only paid without the app, it sets their first password (the SMS proves the number is theirs).
router.post('/password-reset/request', async (req, res) => {
  const body = parse(z.object({ phone }), req.body);
  res.json(await requestReset(body.phone, req.ip));
});

router.post('/password-reset/confirm', async (req, res) => {
  const body = parse(z.object({ phone, code: z.string().trim().regex(/^\d{6}$/, 'The 6-digit code from the SMS'), new_password: password }), req.body);
  res.json(await confirmReset(body.phone, body.code, body.new_password));
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Passengers fix their own name (e.g. mistyped when signing up).
router.patch('/me', authenticate, async (req, res) => {
  const body = parse(z.object({ name }), req.body);
  const user = await renameSelf(req.user, body.name);
  await audit(req.user, 'account.rename', 'users', req.user.id, { name: body.name });
  res.json({ user });
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
