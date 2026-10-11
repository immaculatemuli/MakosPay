// Problem reports: a passenger (or crew member) tells the SACCO office something went wrong; the office
// answers and marks it in progress or resolved. Reports are never deleted.
import { z } from 'zod';
import { db, insertId, NOW } from '../db.js';
import { HttpError, notFound } from '../errors.js';

export const CATEGORIES = ['payment_problem', 'wrong_fare', 'duplicate_charge', 'wrong_route', 'other'];
const MAX_PER_DAY = 10;

export const reportSchema = z.object({
  category: z.enum(CATEGORIES),
  trip_id: z.coerce.number().int().positive().optional(),
  message: z.string().trim().min(5, 'Tell us a little more (at least 5 characters)').max(1000),
});

export const REPORT_SELECT = `
  SELECT r.*, u.name AS reporter_name, u.phone AS reporter_phone, u.role AS reporter_role,
         t.ticket_code, t.fare, t.created_at AS trip_at, v.plate, h.name AS handled_by_name
  FROM reports r
  JOIN users u ON u.id = r.reporter_id
  LEFT JOIN trips t ON t.id = r.trip_id
  LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN users h ON h.id = r.handled_by`;

export const getReport = (id) => db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).get(id);

/** A passenger files a report, optionally about one of their own payments. Limited per day to stop abuse. */
export function fileReport(user, { category, trip_id, message }) {
  if (trip_id) {
    const trip = db.prepare('SELECT passenger_id FROM trips WHERE id = ?').get(trip_id);
    if (!trip || trip.passenger_id !== user.id) throw new HttpError(400, 'NOT_YOUR_PAYMENT', 'That payment is not one of yours');
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at >= ?').get(user.id, since).n;
  if (recent >= MAX_PER_DAY) throw new HttpError(429, 'TOO_MANY_REPORTS', 'You have sent many reports today. Please wait for the SACCO office to reply.');
  const id = insertId(
    db.prepare('INSERT INTO reports (reporter_id, category, trip_id, message) VALUES (?, ?, ?, ?)').run(user.id, category, trip_id ?? null, message),
  );
  return getReport(id);
}

/** The office moves a report along and (optionally) answers the reporter. */
export function updateReport(reportId, officeUserId, { status, office_note }) {
  const existing = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
  if (!existing) throw notFound('Report');
  db.prepare(`UPDATE reports SET status = ?, office_note = COALESCE(?, office_note), handled_by = ?, updated_at = ${NOW} WHERE id = ?`).run(
    status,
    office_note ?? null,
    officeUserId,
    reportId,
  );
  return getReport(reportId);
}
