// The audit log: who did what, when. Entries can only be added (the database refuses edits and deletes).
import { db } from '../database.js';

/**
 * Records one action. `actor` is the signed-in user (or null for the system itself); `details` holds the
 * important values (amounts, old and new fares, reasons). Never put passwords, PINs or secrets in it.
 */
export async function audit(actor, action, entity = null, entityId = null, details = null) {
  await db.run(
    'INSERT INTO audit_log (actor_id, actor_role, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    actor?.id ?? null,
    actor?.role ?? 'system',
    action,
    entity,
    entityId ?? null,
    details ? JSON.stringify(details) : null,
  );
}

// Never stored in the audit log, whatever endpoint they come through.
// ("code" = a parcel's collection code, which only the receiver may know.)
const SECRET_KEYS = /password|pin|secret|token|credential|passkey|^code$/i;

// Long text (e.g. an uploaded M-Pesa statement) is not copied into the log, only its length.
const MAX_TEXT = 1000;

const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[hidden]' : redact(v)]));
  }
  if (typeof value === 'string' && value.length > MAX_TEXT) return `[${value.length} characters]`;
  return value;
};

/**
 * Middleware: every successful change (POST/PUT/PATCH/DELETE answered with 2xx) records who did it, what
 * (e.g. "POST /admin/payments/:id/refund"), which record (:id) and the details sent, minus secrets.
 * The entry is saved before the response is finished, so it is there as soon as the change is.
 */
export function auditChanges(req, res, next) {
  if (req.method === 'GET') return next();
  const end = res.end;
  res.end = function finish(...args) {
    res.end = end;
    if (res.statusCode >= 300 || !req.user) return end.apply(res, args);
    const pattern = `${req.baseUrl}${req.route?.path ?? ''}`;
    const entityId = Number(req.params?.id ?? req.params?.stopId) || null;
    const entity = pattern.split('/').filter((p) => p && !p.startsWith(':'))[1] ?? null;
    audit(req.user, `${req.method} ${pattern}`, entity, entityId, Object.keys(req.body ?? {}).length ? redact(req.body) : null)
      .catch((err) => console.error('[audit] could not record', err.message))
      .finally(() => end.apply(res, args));
    return res;
  };
  next();
}

export async function listAudit({ before, limit, entity, entityId }) {
  const rows = await db.all(
    `SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE (CAST(? AS INTEGER) IS NULL OR a.id < ?) AND (CAST(? AS TEXT) IS NULL OR a.entity = ?) AND (CAST(? AS INTEGER) IS NULL OR a.entity_id = ?)
     ORDER BY a.id DESC LIMIT ?`,
    before ?? null,
    before ?? null,
    entity ?? null,
    entity ?? null,
    entityId ?? null,
    entityId ?? null,
    limit,
  );
  return rows.map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}
