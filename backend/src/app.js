import express from 'express';
import { authenticate, requireRole } from './auth.js';
import { HttpError } from './errors.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import conductorRoutes from './routes/conductor.js';
import mpesaRoutes from './routes/mpesa.js';
import passengerRoutes from './routes/passenger.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRoutes);
  app.use('/admin', authenticate, requireRole('admin'), adminRoutes);
  app.use('/passenger', authenticate, requireRole('passenger'), passengerRoutes);
  app.use('/conductor', authenticate, requireRole('conductor'), conductorRoutes);
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
