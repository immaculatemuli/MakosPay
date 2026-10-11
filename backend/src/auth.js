import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './errors.js';

export const signToken = (user) =>
  jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export function authenticate(req, _res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing bearer token');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token');
  }

  const user = db.prepare('SELECT id, name, phone, role, is_active FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user || !user.is_active) throw new HttpError(401, 'UNAUTHENTICATED', 'Account not found or disabled');
  req.user = user;
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource');
    next();
  };
