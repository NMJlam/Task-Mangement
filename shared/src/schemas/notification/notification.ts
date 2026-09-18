import { z } from "zod";

/**
 * Notification kinds. Constrained rather than free text so the UI can switch
 * exhaustively on the kind to pick an icon and a deep-link route — a typo'd
 * kind would otherwise produce a notification nothing can render.
 *
 * Cost of the closed set, accepted: a new notification type needs a migration.
 */
export const notificationKindSchema = z.enum([
  "task_assigned",
  "task_due",
  // A comment or a file on a task you are assigned or created (R9).
  "task_commented",
  "mention",
  "expense_submitted",
  "expense_decided",
  "invite_accepted",
  "event_created",
  "event_date_changed",
  "event_cancelled",
]);

export type NotificationKind = z.infer<typeof notificationKindSchema>;

/**
 * Mirrors the `notification` table column for column (see
 * `backend/src/db/schema/notification.ts`), so a bare `.select()` satisfies
 * this schema without a projection step — same convention as `taskSchema`.
 *
 * `entityType`/`entityId` are a deep-link target with no FK (one table serves
 * every entity type), so both stay nullable and travel together (enforced at
 * the DB by `notification_entity_all_or_nothing_check`).
 */
export const notificationSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  kind: notificationKindSchema,
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.uuid().nullable(),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type Notification = z.infer<typeof notificationSchema>;

/** Route params for every /notifications/:id endpoint. */
export const notificationParamsSchema = z.object({ id: z.uuid() });

// ── GET /api/notifications ───────────────────────────────────────────────────

/**
 * Always scoped to the caller — there is no `userId` filter here, unlike
 * `listTasksQuerySchema`. A notification feed is never read on someone else's
 * behalf, so the route derives the recipient from the session, not the query.
 */
export const listNotificationsQuerySchema = z.object({
  // Not z.coerce.boolean(): Boolean("false") is true.
  unreadOnly: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

/**
 * `unreadCount` rides along with the feed rather than needing a second
 * request — the table already carries `notification_unread_idx` for exactly
 * this "badge on every screen" read.
 */
export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int(),
});

export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationResponseSchema = z.object({ notification: notificationSchema });

export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export const markAllNotificationsReadResponseSchema = z.object({ count: z.number().int() });

export type MarkAllNotificationsReadResponse = z.infer<
  typeof markAllNotificationsReadResponseSchema
>;
