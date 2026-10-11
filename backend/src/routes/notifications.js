// Everyone's own notifications (the bell): passengers, crew and office alike. Each person only sees theirs.
import { Router } from 'express';
import { z } from 'zod';
import { listNotifications, markRead, unreadCount } from '../services/notifications.js';
import { id, parse } from '../validate.js';

const router = Router();

router.get('/', async (req, res) => {
  const query = parse(z.object({ before: id.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
  res.json(await listNotifications(req.user.id, query));
});

// Cheap enough to ask every half minute for the number on the bell.
router.get('/unread', async (req, res) => {
  res.json({ unread: await unreadCount(req.user.id) });
});

// { id } marks one as read; no id marks them all.
router.post('/read', async (req, res) => {
  const { id: notificationId } = parse(z.object({ id: id.optional() }), req.body ?? {});
  res.json(await markRead(req.user.id, notificationId ?? null));
});

export default router;
