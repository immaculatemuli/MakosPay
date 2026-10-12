import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './database.js';
import { HttpError } from './errors.js';

// Two ways to be signed in:
//  - the phone app sends "Authorization: Bearer <token>" (kept in the phone's secure storage, 30 days);
//  - the office web dashboard gets a cookie its own scripts can't read (HttpOnly), sent only to FarePay
//    itself (SameSite=Strict), valid for WEB_SESSION_HOURS. Office accounts only.
// The dashboard is served from the same address as the API, so no other website can use the API from a browser.
export const OFFICE_COOKIE = 'farepay_office';
const WEB_AUDIENCE = 'farepay-office-web';
// Every change made with the cookie must carry this header. Other websites can't add it to a request
// without the API's permission (CORS), which is never given - so they can't make the office's browser act.
export const WEB_CLIENT_HEADER = 'x-farepay-client';
export const WEB_CLIENT_VALUE = 'office-web';
export const OFFICE_ROLES = ['admin', 'platform_admin'];

// `v` is the account's session version: changing or resetting the password raises it, which signs out every
// phone and browser still holding an older sign-in.
export async function signToken(user, { web = false } = {}) {
  const { session_version: v } = await db.get('SELECT session_version FROM users WHERE id = ?', user.id);
  const claims = { sub: String(user.id), role: user.role, v };
  return web
    ? jwt.sign(claims, config.jwtSecret, { expiresIn: `${config.webSessionHours}h`, audience: WEB_AUDIENCE })
    : jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Puts the office sign-in in an HttpOnly cookie (Secure on https). */
export async function setOfficeCookie(req, res, user) {
  const token = await signToken(user, { web: true });
  const secure = req.secure || config.env === 'production';
  res.append('Set-Cookie', `${OFFICE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.webSessionHours * 3600}${secure ? '; Secure' : ''}`);
}

export function clearOfficeCookie(req, res) {
  const secure = req.secure || config.env === 'production';
  res.append('Set-Cookie', `${OFFICE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}

function readCookie(req, name) {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requests from the web dashboard: changes need the dashboard's header, and if the browser says where the
 * request comes from (Origin), it must be FarePay's own address. Stops other websites making the office's
 * browser do things (cross-site request forgery).
 */
export function checkWebRequest(req) {
  if (SAFE_METHODS.has(req.method)) return;
  if (req.get(WEB_CLIENT_HEADER) !== WEB_CLIENT_VALUE) throw new HttpError(403, 'WEB_HEADER_MISSING', 'This request did not come from the FarePay office dashboard');
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) throw new HttpError(403, 'WRONG_ORIGIN', 'This request did not come from the FarePay office dashboard');
}

export async function authenticate(req, _res, next) {
  const [scheme, bearer] = (req.get('authorization') ?? '').split(' ');
  const fromCookie = !bearer ? readCookie(req, OFFICE_COOKIE) : null;
  const token = scheme === 'Bearer' && bearer ? bearer : fromCookie;
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing bearer token');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  }
  // A web sign-in only works as the cookie, and a phone sign-in only as a bearer token. Other FarePay tokens
  // (e.g. a no-app payment's status link) are never a sign-in.
  if (payload.aud !== undefined && payload.aud !== WEB_AUDIENCE) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  if ((payload.aud === WEB_AUDIENCE) !== Boolean(fromCookie)) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  if (fromCookie) checkWebRequest(req);

  const user = await db.get('SELECT id, name, phone, role, is_active, session_version FROM users WHERE id = ?', Number(payload.sub));
  if (!user || !user.is_active) throw new HttpError(401, 'UNAUTHENTICATED', 'Account not found or disabled');
  if ((payload.v ?? 0) !== user.session_version) throw new HttpError(401, 'UNAUTHENTICATED', 'Your password was changed. Please sign in again.');
  if (fromCookie && !OFFICE_ROLES.includes(user.role)) throw new HttpError(401, 'UNAUTHENTICATED', 'Account not found or disabled');
  const { session_version: _, ...rest } = user;
  req.user = rest;
  req.signedInWith = fromCookie ? 'web' : 'app';
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource');
    next();
  };
