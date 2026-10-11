import express from 'express';
import { authenticate, requireRole } from './auth.js';
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
  // Small bodies everywhere, except an uploaded M-Pesa statement (a CSV file sent as text).
  const smallJson = express.json({ limit: '100kb' });
  const statementJson = express.json({ limit: '6mb' });
  app.use((req, res, next) => (req.path === '/admin/statement-check' ? statementJson : smallJson)(req, res, next));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRoutes);
  // Every change made by office, platform and crew accounts is recorded in the audit log (auditChanges).
  // The platform admin can do everything the SACCO office can, plus the platform screens.
  app.use('/admin', authenticate, requireRole('admin', 'platform_admin'), auditChanges, adminRoutes);
  app.use('/platform', authenticate, requireRole('platform_admin'), auditChanges, platformRoutes);
  app.use('/passenger', authenticate, requireRole('passenger'), passengerRoutes);
  // Conductors and drivers. '/conductor' is the older address, kept for apps installed before drivers existed.
  app.use(['/crew', '/conductor'], authenticate, requireRole('conductor', 'driver'), auditChanges, crewRoutes);
  app.use('/notifications', authenticate, notificationRoutes);
  app.use('/mpesa', mpesaRoutes);

  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return app;
}
