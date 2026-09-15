import { z } from "zod";

/**
 * Closes `TODO(R12)` for the events+calendar slice only — other slices add
 * their own actions to this enum as they land audit logging, rather than each
 * inventing a parallel string union.
 */
export const auditActionSchema = z.enum([
  "event.created",
  "event.updated",
  "event.status_changed",
  "event.cancelled",
]);

export type AuditAction = z.infer<typeof auditActionSchema>;
