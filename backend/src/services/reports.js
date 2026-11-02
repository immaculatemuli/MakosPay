// Problem reports: a passenger (or crew member) tells the SACCO office something went wrong; then both sides
// can keep writing to each other on it (report_messages), and the office marks it in progress or resolved.
// Any message can carry one photo (report_photos), e.g. a screenshot of an M-Pesa message.
// Reports, their messages and photos are never deleted.
import { z } from 'zod';
import { db, NOW, tx } from '../database.js';
import { HttpError, notFound } from '../errors.js';
import { notify, notifyOffice } from './notifications.js';

export const CATEGORIES = ['payment_problem', 'wrong_fare', 'duplicate_charge', 'wrong_route', 'other'];
const MAX_PER_DAY = 10;
const MAX_REPLIES_PER_DAY = 50;
const MAX_PHOTOS_PER_DAY = 10;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// A photo arrives as base64 text (JPEG, PNG or WebP, at most 2 MB).
const photo = z.string().max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4, 'The photo is too big (at most 2 MB)').optional();

// A reply is some words, a photo, or both.
export const replySchema = z
  .object({ message: z.string().trim().max(1000).default(''), photo })
  .refine((b) => b.message.length > 0 || b.photo, { message: 'Write a message', path: ['message'] });

export const reportSchema = z.object({
  category: z.enum(CATEGORIES),
  trip_id: z.coerce.number().int().positive().optional(),
  message: z.string().trim().min(5, 'Tell us a little more (at least 5 characters)').max(1000),
  photo,
});

// What the file really is, from its first bytes (never trusting what the phone says it is).
const SIGNATURES = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

/** The photo's bytes and type, or a clear error. Also limits how many photos one person sends a day. */
async function readPhoto(userId, base64) {
  if (!base64) return null;
  const data = Buffer.from(base64, 'base64');
  const mime = SIGNATURES.find(([, matches]) => data.length > 12 && matches(data))?.[0];
  if (!mime) throw new HttpError(400, 'BAD_PHOTO', 'Send the photo as a JPEG, PNG or WebP picture');
  if (data.length > MAX_PHOTO_BYTES) throw new HttpError(400, 'BAD_PHOTO', 'The photo is too big (at most 2 MB)');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sent = (
    await db.get('SELECT COUNT(*) AS n FROM report_photos p JOIN reports r ON r.id = p.report_id WHERE r.reporter_id = ? AND p.created_at >= ?', userId, since)
  ).n;
  if (sent >= MAX_PHOTOS_PER_DAY) throw new HttpError(429, 'TOO_MANY_PHOTOS', 'You have sent many photos today. Please try again tomorrow.');
  return { mime, data };
}

const savePhoto = (reportId, messageId, { mime, data }) =>
  db.run('INSERT INTO report_photos (report_id, message_id, mime_type, data) VALUES (?, ?, ?, ?)', reportId, messageId, mime, data);

/** One photo of a report, if it exists (`reporterId`: only from that person's own reports). */
export async function getPhoto(reportId, photoId, { reporterId } = {}) {
  const row = await db.get(
    'SELECT p.mime_type, p.data FROM report_photos p JOIN reports r ON r.id = p.report_id WHERE p.id = ? AND p.report_id = ? AND (CAST(? AS INTEGER) IS NULL OR r.reporter_id = ?)',
    photoId,
    reportId,
    reporterId ?? null,
    reporterId ?? null,
  );
  if (!row) throw notFound('Photo');
  return row;
}

export const REPORT_SELECT = `
  SELECT r.*, u.name AS reporter_name, u.phone AS reporter_phone, u.role AS reporter_role,
         t.ticket_code, t.fare, t.created_at AS trip_at, v.plate, h.name AS handled_by_name
  FROM reports r
  JOIN users u ON u.id = r.reporter_id
  LEFT JOIN trips t ON t.id = r.trip_id
  LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN users h ON h.id = r.handled_by`;

/**
 * Adds each report's conversation (`messages`, oldest first) to the rows. `forOffice` adds who in the office
 * wrote each reply; the reporter only sees "the SACCO office".
 */
export async function withMessages(rows, { forOffice = false } = {}) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const messages = await db.all(
    `SELECT m.id, m.report_id, m.from_office, m.message, m.created_at, u.name AS sender_name
     FROM report_messages m LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.report_id IN (${ids.map(() => '?').join(', ')}) ORDER BY m.id`,
    ...ids,
  );
  // Which message each photo belongs to ("first-<report>" = the report's own first message).
  const photos = await db.all(`SELECT id, report_id, message_id FROM report_photos WHERE report_id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`, ...ids);
  const photoOf = new Map(photos.map((p) => [p.message_id ?? `first-${p.report_id}`, p.id]));
  const byReport = new Map(ids.map((reportId) => [reportId, []]));
  for (const { report_id, sender_name, ...m } of messages) {
    const withPhoto = { ...m, photo_id: photoOf.get(m.id) ?? null };
    byReport.get(report_id).push(forOffice ? { ...withPhoto, sender_name } : withPhoto);
  }
  return rows.map((r) => ({ ...r, photo_id: photoOf.get(`first-${r.id}`) ?? null, messages: byReport.get(r.id) }));
}

export const getReport = async (id, options) => (await withMessages([await db.get(`${REPORT_SELECT} WHERE r.id = ?`, id)], options))[0];

// What the reporter sees of their own report: not who in the office handled it.
const forReporter = ({ reporter_phone, handled_by, handled_by_name, office_seen_at, ...r }) => r;

// `has_new`: something the reader hasn't seen yet. For the reporter, an office reply since they last looked;
// for the office, a report nobody in the office has looked at, or a reporter's message since they did.
const NEW_FOR_REPORTER = `EXISTS (SELECT 1 FROM report_messages m WHERE m.report_id = r.id AND m.from_office = TRUE
  AND (r.reporter_seen_at IS NULL OR m.created_at > r.reporter_seen_at)) AS has_new`;
const NEW_FOR_OFFICE = `(r.office_seen_at IS NULL OR EXISTS (SELECT 1 FROM report_messages m WHERE m.report_id = r.id
  AND m.from_office = FALSE AND m.created_at > r.office_seen_at)) AS has_new`;
const withNew = (expression) => REPORT_SELECT.replace('SELECT r.*,', `SELECT r.*, ${expression},`);

/**
 * One person's own reports, newest first, with their conversations (for the passenger and crew apps).
 * Looking counts as seeing them: `has_new` shows this once, then the reports count as seen.
 */
export async function myReports(userId) {
  const rows = await db.all(`${withNew(NEW_FOR_REPORTER)} WHERE r.reporter_id = ? ORDER BY r.id DESC LIMIT 50`, userId);
  if (rows.length) await db.run(`UPDATE reports SET reporter_seen_at = ${NOW} WHERE reporter_id = ?`, userId);
  return withMessages(rows.map(forReporter));
}

/** The office's list (optionally one status), newest first, with conversations; the reports shown count as seen. */
export async function officeReports(status) {
  const rows = await db.all(
    `${withNew(NEW_FOR_OFFICE)} WHERE (CAST(? AS TEXT) IS NULL OR r.status = ?) ORDER BY r.id DESC LIMIT 200`,
    status ?? null,
    status ?? null,
  );
  if (rows.length) await db.run(`UPDATE reports SET office_seen_at = ${NOW} WHERE id IN (${rows.map(() => '?').join(', ')})`, ...rows.map((r) => r.id));
  return withMessages(rows, { forOffice: true });
}

const preview = (text) => (text.length > 140 ? `${text.slice(0, 140)}…` : text);

/** The reporter writes more on their report (words and/or a photo). Writing on a resolved report opens it again. */
export async function reporterReply(user, reportId, { message, photo: photoBase64 }) {
  const report = await db.get('SELECT id, status FROM reports WHERE id = ? AND reporter_id = ?', reportId, user.id);
  if (!report) throw notFound('Report');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = (await db.get('SELECT COUNT(*) AS n FROM report_messages WHERE sender_id = ? AND created_at >= ?', user.id, since)).n;
  if (recent >= MAX_REPLIES_PER_DAY) throw new HttpError(429, 'TOO_MANY_MESSAGES', 'You have sent many messages today. Please wait for the SACCO office to reply.');
  const picture = await readPhoto(user.id, photoBase64);
  await tx(async () => {
    const messageId = await db.insert('INSERT INTO report_messages (report_id, sender_id, from_office, message) VALUES (?, ?, FALSE, ?)', reportId, user.id, message);
    if (picture) await savePhoto(reportId, messageId, picture);
    await db.run(
      `UPDATE reports SET status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END, reporter_seen_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`,
      reportId,
    );
  });
  await notifyOffice({
    kind: 'report.reply',
    title: `${user.name} (${ROLE_WORD[user.role] ?? 'reporter'}) wrote on their report${report.status === 'resolved' ? ': opened again' : ''}`,
    body: preview(message || 'Sent a photo'),
    target: 'reports',
  });
  return forReporter(await getReport(reportId));
}

/** The office writes to the reporter on their report (the report's status stays as it is). */
export async function officeReply(officeUserId, reportId, { message }) {
  const report = await db.get('SELECT id, reporter_id FROM reports WHERE id = ?', reportId);
  if (!report) throw notFound('Report');
  await db.run('INSERT INTO report_messages (report_id, sender_id, from_office, message) VALUES (?, ?, TRUE, ?)', reportId, officeUserId, message);
  await db.run(`UPDATE reports SET handled_by = ?, office_seen_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`, officeUserId, reportId);
  await notify([report.reporter_id], { kind: 'report.updated', title: 'The SACCO office replied to your report', body: preview(message), target: 'reports' });
  return getReport(reportId, { forOffice: true });
}

/**
 * Files a report, optionally about one payment: a passenger's own payment, or (for crew, `vehicleId` set)
 * a payment made on their vehicle. Limited per day to stop abuse.
 */
export async function fileReport(user, { category, trip_id, message, photo: photoBase64 }, { vehicleId } = {}) {
  if (trip_id) {
    const trip = await db.get('SELECT passenger_id, vehicle_id FROM trips WHERE id = ?', trip_id);
    const allowed = trip && (vehicleId ? trip.vehicle_id === vehicleId : trip.passenger_id === user.id);
    if (!allowed) throw new HttpError(400, 'NOT_YOUR_PAYMENT', vehicleId ? 'That payment was not made on your vehicle' : 'That payment is not one of yours');
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = (await db.get('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at >= ?', user.id, since)).n;
  if (recent >= MAX_PER_DAY) throw new HttpError(429, 'TOO_MANY_REPORTS', 'You have sent many reports today. Please wait for the SACCO office to reply.');
  const picture = await readPhoto(user.id, photoBase64);
  const id = await tx(async () => {
    const reportId = await db.insert('INSERT INTO reports (reporter_id, category, trip_id, message) VALUES (?, ?, ?, ?)', user.id, category, trip_id ?? null, message);
    if (picture) await savePhoto(reportId, null, picture);
    return reportId;
  });
  await notifyOffice({
    kind: 'report.new',
    title: `New problem report from ${ROLE_WORD[user.role] ?? ''} ${user.name}`.replace(/\s+/g, ' '),
    body: preview(message),
    target: 'reports',
  });
  return getReport(id);
}

const ROLE_WORD = { passenger: 'passenger', conductor: 'conductor', driver: 'driver' };
const STATUS_WORD = { open: 'reopened', in_progress: 'being looked into', resolved: 'resolved' };

/**
 * The office moves a report along and (optionally) answers the reporter, who is told about it.
 * (Apps from before conversations send their reply here as office_note: it becomes a message too.)
 */
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
  if (office_note) {
    await db.run('INSERT INTO report_messages (report_id, sender_id, from_office, message) VALUES (?, ?, TRUE, ?)', reportId, officeUserId, office_note);
  }
  if (office_note || status !== existing.status) {
    await notify([existing.reporter_id], {
      kind: 'report.updated',
      title: office_note ? 'The SACCO office replied to your report' : `Your report is ${STATUS_WORD[status]}`,
      body: office_note ? `${office_note}${status !== existing.status ? ` (now ${STATUS_WORD[status]})` : ''}` : null,
      target: 'reports',
    });
  }
  return getReport(reportId, { forOffice: true });
}

/**
 * Answers with a report photo. Its own security policy lets the browser show the picture when opened in a
 * tab (the API's usual policy allows nothing), and nothing else.
 */
export function sendPhoto(res, photo) {
  res
    .set({ 'Content-Type': photo.mime_type, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; frame-ancestors 'none'" })
    .send(Buffer.from(photo.data));
}
