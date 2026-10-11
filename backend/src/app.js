import express from 'express';
import { authenticate, requireRole } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './errors.js';
import { auditChanges } from './services/audit.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import crewRoutes from './routes/crew.js';
import mpesaRoutes from './routes/mpesa.js';
import notificationRoutes from './routes/notifications.js';
import passengerRoutes from './routes/passenger.js';
import platformRoutes from './routes/platform.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a proxy (Caddy, Cloudflare) the real phone's address comes in X-Forwarded-For: needed for the limits.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  // This API only serves the app: nothing may be cached (wallets, payments) or shown inside other websites.
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    next();
  });
  // Small bodies everywhere, except an uploaded M-Pesa statement (a CSV file sent as text).
  const smallJson = express.json({ limit: '100kb' });
  const statementJson = express.json({ limit: '6mb' });
  app.use((req, res, next) => (req.path === '/admin/statement-check' ? statementJson : smallJson)(req, res, next));

  // For the hosting's uptime check: also makes sure the database answers.
  app.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.use('/auth', authRoutes);
  // Every change made by office, platform and crew accounts is recorded in the audit log (auditChanges).
  // The platform admin can do everything the SACCO office can, plus the platform screens.
  app.use('/admin', authenticate, requireRole('admin', 'platform_admin'), auditChanges, adminRoutes);
  app.use('/platform', authenticate, requireRole('platform_admin'), auditChanges, platformRoutes);
  app.use('/passenger', authenticate, requireRole('passenger'), passengerRoutes);
  // Conductors and drivers. '/conductor' is the older address, kept for apps installed before drivers existed.
  app.use(['/crew', '/conductor'], authenticate, requireRole('conductor', 'driver'), auditChanges, crewRoutes);
  app.use('/notifications', authenticate, notificationRoutes);
  // M-Pesa's callbacks: /hooks/<secret>/... (sent to Safaricom); /mpesa/callback/<secret>/... still works for
  // payments started before the address changed.
  app.use('/hooks', (req, _res, next) => {
    req.url = `/callback${req.url}`;
    next();
  }, mpesaRoutes);
  app.use('/mpesa', mpesaRoutes);

  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.details?.retry_after_seconds) res.set('Retry-After', String(err.details.retry_after_seconds));
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'That is too much data to send at once' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return app;
}
