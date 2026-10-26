import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { authenticate, requireRole } from './auth.js';
import { config } from './config.js';
import { db } from './database.js';
import { HttpError } from './errors.js';
import { auditChanges } from './services/audit.js';
import { noteActivity } from './services/quiet.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/booking.js';
import crewRoutes from './routes/crew.js';
import marshalRoutes from './routes/marshal.js';
import mpesaRoutes from './routes/mpesa.js';
import ussdRoutes from './routes/ussd.js';
import notificationRoutes from './routes/notifications.js';
import { payApi, payPage } from './routes/noapp.js';
import passengerRoutes from './routes/passenger.js';
import platformRoutes from './routes/platform.js';

// Dashboard pages may load only their own scripts, styles and data from FarePay (plus the QR picture,
// which arrives as data), and may not be shown inside other websites.
const OFFICE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function serveOfficeDashboard(app) {
  const dir = config.officeWebDir;
  if (!existsSync(join(dir, 'index.html'))) return; // not built (e.g. on a server that only runs the API)
  const page = (_req, res) => res.sendFile(join(dir, 'index.html'));
  // Express treats /office and /office/ alike: only the one without the slash is redirected.
  app.get('/office', (req, res, next) => (req.originalUrl.split('?')[0] === '/office' ? res.redirect(301, '/office/') : next()));
  app.use(
    '/office',
    (_req, res, next) => {
      res.set('Content-Security-Policy', OFFICE_CSP);
      next();
    },
    express.static(dir, { index: 'index.html', redirect: false }),
    // Any other address under /office/ is a screen of the dashboard (e.g. /office/vehicles/3).
    (req, res, next) => (req.method === 'GET' ? page(req, res) : next()),
  );
}

// The public website: its own stylesheet, script and pictures only (plus Google's or OpenStreetMap's map tiles, for
// the map of the car coming to pick a passenger).
const WEBSITE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://tile.googleapis.com https://tile.openstreetmap.org; connect-src 'self'; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// The website's public pages, for search engines (the office, pay page and API stay out of search results).
const PUBLIC_PAGES = ['/', '/app', '/book', '/parcels', '/privacy'];

function serveWebsite(app) {
  const dir = config.websiteDir;
  if (!existsSync(join(dir, 'index.html'))) return;
  // Built from the address the visitor used, so they stay right when the site moves to its own domain.
  const siteUrl = (req) => `${req.protocol}://${req.get('host')}`;
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nDisallow: /office/\nDisallow: /pay\nAllow: /\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (req, res) => {
    const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${siteUrl(req)}${p}</loc></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });
  // Google Search Console's proof that the site is ours: GOOGLE_SITE_VERIFICATION is the file name it gives
  // (e.g. google1a2b3c4d5e6f.html), answered with the line Google expects.
  if (config.googleSiteVerification) {
    app.get(`/${config.googleSiteVerification}`, (_req, res) => {
      res.type('text/html').send(`google-site-verification: ${config.googleSiteVerification}`);
    });
  }
  app.use(
    (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.set('Content-Security-Policy', WEBSITE_CSP);
      // Pages and their files may be cached briefly (they hold nothing private).
      res.set('Cache-Control', 'public, max-age=300');
      next();
    },
    // extensions: /app opens app.html (the short link people are sent to download the app).
    express.static(dir, { index: 'index.html', redirect: false, extensions: ['html'] }),
  );
}

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
  // Small bodies everywhere, except an uploaded M-Pesa statement (a CSV file sent as text) and a problem report
  // or reply from a passenger or crew member, which can carry a photo (at most 2 MB, sent as base64 text).
  const smallJson = express.json({ limit: '100kb' });
  const statementJson = express.json({ limit: '6mb' });
  const photoJson = express.json({ limit: '3mb' });
  const PHOTO_PATHS = /^\/(passenger|crew|conductor)\/reports(\/\d+\/messages)?$/;
  // A spreadsheet of hundreds of vehicles or crew, read into rows by the dashboard.
  const IMPORT_PATH = /^\/admin\/import\/\w+$/;
  app.use((req, res, next) =>
    (req.path === '/admin/statement-check' || IMPORT_PATH.test(req.path) ? statementJson : PHOTO_PATHS.test(req.path) ? photoJson : smallJson)(req, res, next),
  );

  // For the hosting's uptime check and the keep-awake ping: the server is up. It doesn't touch the database (so the
  // pings let it sleep) and isn't counted as use. /health/db also makes sure the database answers.
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/health/db', async (_req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, database: true });
  });
  // Anything else is FarePay in use: background jobs run for a while after it (services/quiet.js).
  app.use((_req, _res, next) => {
    noteActivity();
    next();
  });
  app.use('/auth', authRoutes);
  // Every change made by office, platform and crew accounts is recorded in the audit log (auditChanges).
  // The platform admin can do everything the SACCO office can, plus the platform screens.
  app.use('/admin', authenticate, requireRole('admin', 'platform_admin'), auditChanges, adminRoutes);
  app.use('/platform', authenticate, requireRole('platform_admin'), auditChanges, platformRoutes);
  app.use('/passenger', authenticate, requireRole('passenger'), passengerRoutes);
  // Conductors and drivers. '/conductor' is the older address, kept for apps installed before drivers existed.
  app.use(['/crew', '/conductor'], authenticate, requireRole('conductor', 'driver'), auditChanges, crewRoutes);
  // Stage marshals (the office can use the same screens).
  app.use('/marshal', authenticate, requireRole('marshal', 'admin', 'platform_admin'), auditChanges, marshalRoutes);
  app.use('/notifications', authenticate, notificationRoutes);
  // Passengers without the app: the QR sticker's link opens the pay page, which uses /pay-api.
  app.use(payPage);
  app.use('/pay-api', payApi);
  // Seat booking on the website.
  app.use('/book-api', bookingRoutes);
  // M-Pesa's callbacks: /hooks/<secret>/... (sent to Safaricom); /mpesa/callback/<secret>/... still works for
  // payments started before the address changed.
  app.use('/hooks', (req, _res, next) => {
    req.url = `/callback${req.url}`;
    next();
  }, mpesaRoutes);
  app.use('/mpesa', mpesaRoutes);
  // USSD (Africa's Talking): /ussd/<secret>.
  app.use('/ussd', ussdRoutes);

  // The office web dashboard (admin-web, built with `yarn build`), at the same address as the API.
  serveOfficeDashboard(app);
  // The public website at the main address (last, so it never hides an API address).
  serveWebsite(app);

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
