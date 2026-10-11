// The audit log: who did what, when. Entries can only be added (the database refuses edits and deletes).
import { db } from '../db.js';

/**
 * Records one action. `actor` is the signed-in user (or null for the system itself); `details` holds the
 * important values (amounts, old and new fares, reasons). Never put passwords, PINs or secrets in it.
 */
export function audit(actor, action, entity = null, entityId = null, details = null) {
  db.prepare('INSERT INTO audit_log (actor_id, actor_role, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(
    actor?.id ?? null,
    actor?.role ?? 'system',
    action,
    entity,
    entityId ?? null,
    details ? JSON.stringify(details) : null,
  );
}

// Never stored in the audit log, whatever endpoint they come through.
const SECRET_KEYS = /password|pin|secret|token|credential|passkey/i;

const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[hidden]' : redact(v)]));
  }
  return value;
};

/**
 * Middleware: after every successful change (POST/PUT/PATCH/DELETE answered with 2xx) records who did it,
 * what (e.g. "POST /admin/payments/:id/refund"), which record (:id) and the details sent, minus secrets.
 */
export function auditChanges(req, res, next) {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode >= 300 || !req.user) return;
    const pattern = `${req.baseUrl}${req.route?.path ?? ''}`;
    const entityId = Number(req.params?.id ?? req.params?.stopId) || null;
    const entity = pattern.split('/').filter((p) => p && !p.startsWith(':'))[1] ?? null;
    try {
      audit(req.user, `${req.method} ${pattern}`, entity, entityId, Object.keys(req.body ?? {}).length ? redact(req.body) : null);
    } catch (err) {
      console.error('[audit] could not record', err.message);
    }
  });
  next();
}

export function listAudit({ before, limit, entity, entityId }) {
  return db
    .prepare(
      `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.id < ? AND (? IS NULL OR a.entity = ?) AND (? IS NULL OR a.entity_id = ?)
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(before ?? Number.MAX_SAFE_INTEGER, entity ?? null, entity ?? null, entityId ?? null, entityId ?? null, limit)
    .map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}
