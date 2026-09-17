import {
  listNotificationsQuerySchema,
  notificationParamsSchema,
  type ListNotificationsQuery,
  type MarkAllNotificationsReadResponse,
  type NotificationListResponse,
  type NotificationResponse,
} from "@ctp/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { notifications } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const notificationsRouter = Router();

/**
 * Notification feed (R-notifications).
 *
 * Every route here is scoped to the caller — there is no admin view of
 * someone else's feed, so `authorise(0)` is the only tier gate: rank has
 * nothing to say about your own notifications. The recipient always comes
 * from `req.user!.id`, never from a param or query value, the same way
 * `GET /api/me` never accepts an id.
 */

function notFound(res: Response): void {
  // Same body whether the id doesn't exist or belongs to someone else — a 403
  // here would confirm another user's notification exists (mirrors the
  // events.ts min_tier "hides, doesn't forbid" convention).
  res
    .status(404)
    .json({ error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found." } });
}

// ── GET /api/notifications ───────────────────────────────────────────────────

notificationsRouter.get(
  "/notifications",
  authenticate,
  authorise(0),
  validate(listNotificationsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = res.locals.validated as ListNotificationsQuery;
      const userId = req.user!.id;
      const db = getDb();

      const scope = query.unreadOnly
        ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
        : eq(notifications.userId, userId);

      const [rows, unreadCountRows] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(scope)
          .orderBy(desc(notifications.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
      ]);
      const unreadCount = unreadCountRows[0]?.count ?? 0;

      res.status(200).json({ notifications: rows, unreadCount } satisfies NotificationListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────

notificationsRouter.patch(
  "/notifications/:id/read",
  authenticate,
  authorise(0),
  validate(notificationParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = res.locals.validated as { id: string };
      const userId = req.user!.id;
      const db = getDb();

      const [existing] = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .limit(1);
      if (!existing) return notFound(res);

      // Idempotent: marking an already-read notification as read is a no-op,
      // not an error, the same way DELETE /api/teams/:teamId/members/:userId
      // is idempotent.
      if (existing.readAt) {
        res.status(200).json({ notification: existing } satisfies NotificationResponse);
        return;
      }

      const [row] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, id))
        .returning();

      res.status(200).json({ notification: row! } satisfies NotificationResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── PATCH /api/notifications/read-all ────────────────────────────────────────

notificationsRouter.patch(
  "/notifications/read-all",
  authenticate,
  authorise(0),
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const rows = await getDb()
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
        .returning({ id: notifications.id });

      res.status(200).json({ count: rows.length } satisfies MarkAllNotificationsReadResponse);
    } catch (error) {
      next(error);
    }
  },
);
