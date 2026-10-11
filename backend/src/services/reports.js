// Problem reports: a passenger (or crew member) tells the SACCO office something went wrong; the office
// answers and marks it in progress or resolved. Reports are never deleted.
import { z } from 'zod';
import { db, NOW } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { notify, notifyOffice } from './notifications.js';

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

export const getReport = (id) => db.get(`${REPORT_SELECT} WHERE r.id = ?`, id);

/**
 * Files a report, optionally about one payment: a passenger's own payment, or (for crew, `vehicleId` set)
 * a payment made on their vehicle. Limited per day to stop abuse.
 */
export async function fileReport(user, { category, trip_id, message }, { vehicleId } = {}) {
  if (trip_id) {
    const trip = await db.get('SELECT passenger_id, vehicle_id FROM trips WHERE id = ?', trip_id);
    const allowed = trip && (vehicleId ? trip.vehicle_id === vehicleId : trip.passenger_id === user.id);
    if (!allowed) throw new HttpError(400, 'NOT_YOUR_PAYMENT', vehicleId ? 'That payment was not made on your vehicle' : 'That payment is not one of yours');
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = (await db.get('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at >= ?', user.id, since)).n;
  if (recent >= MAX_PER_DAY) throw new HttpError(429, 'TOO_MANY_REPORTS', 'You have sent many reports today. Please wait for the SACCO office to reply.');
  const id = await db.insert('INSERT INTO reports (reporter_id, category, trip_id, message) VALUES (?, ?, ?, ?)', user.id, category, trip_id ?? null, message);
  await notifyOffice({
    kind: 'report.new',
    title: `New problem report from ${ROLE_WORD[user.role] ?? ''} ${user.name}`.replace(/\s+/g, ' '),
    body: message.length > 140 ? `${message.slice(0, 140)}…` : message,
    target: 'reports',
  });
  return getReport(id);
}

const ROLE_WORD = { passenger: 'passenger', conductor: 'conductor', driver: 'driver' };
const STATUS_WORD = { open: 'reopened', in_progress: 'being looked into', resolved: 'resolved' };

/** The office moves a report along and (optionally) answers the reporter, who is told about it. */
export async function updateReport(reportId, officeUserId, { status, office_note }) {
  const existing = await db.get('SELECT id, reporter_id, status FROM reports WHERE id = ?', reportId);
  if (!existing) throw notFound('Report');
  await db.run(
    `UPDATE reports SET status = ?, office_note = COALESCE(?, office_note), handled_by = ?, updated_at = ${NOW} WHERE id = ?`,
    status,
    office_note ?? null,
    officeUserId,
    reportId,
  );
  if (office_note || status !== existing.status) {
    await notify([existing.reporter_id], {
      kind: 'report.updated',
      title: office_note ? 'The SACCO office replied to your report' : `Your report is ${STATUS_WORD[status]}`,
      body: office_note ? `${office_note}${status !== existing.status ? ` (now ${STATUS_WORD[status]})` : ''}` : null,
      target: 'reports',
    });
  }
  return getReport(reportId);
}
