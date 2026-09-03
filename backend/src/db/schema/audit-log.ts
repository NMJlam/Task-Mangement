import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";

/**
 * Append-only audit trail (R12). `changes` is jsonb — a structured before/after
 * diff, shape TBD. The audit-write path is why maxDuration is bumped to 30s in
 * vercel.json. TODO(R12): finalise the `changes` shape and index strategy.
 *
 * Also backs the /api/example/audit fixture route, the repo's documented worked
 * example for the integration-test tier (docs/contributing.md).
 *
 * No index yet — add (entity_type, entity_id, created_at DESC) only when a real
 * read path needs it.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),

  // SET NULL so a departing member's trail survives as "former member".
  // This FK was MISSING: the original migration pointed actor_id at a `users`
  // table that a later migration dropped with CASCADE, silently taking the
  // constraint with it and leaving the column referencing nothing.
  actorId: uuid("actor_id").references(() => appUsers.id, { onDelete: "set null" }),

  // e.g. "task.updated" — TODO(R12): enumerate actions.
  action: text("action").notNull(),
  // Target entity type + id, e.g. { type: "task", id: <uuid> }.
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
