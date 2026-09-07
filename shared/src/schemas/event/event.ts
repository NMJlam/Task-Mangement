import { z } from "zod";

/**
 * Event lifecycle. `cancelled` IS the soft delete — there is no `deleted_at`,
 * because RESTRICT on `expense.event_id` already makes a destructive delete
 * impossible, and a soft-delete flag that leaks from one query is worse than a
 * hard delete.
 */
export const eventStatusSchema = z.enum(["planning", "live", "wrapped", "cancelled"]);

export type EventStatus = z.infer<typeof eventStatusSchema>;
