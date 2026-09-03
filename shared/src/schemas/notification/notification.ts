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
  "mention",
  "expense_decided",
  "invite_accepted",
  "event_created",
]);

export type NotificationKind = z.infer<typeof notificationKindSchema>;
