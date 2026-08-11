import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Append-only audit trail (R12). `changes` is jsonb — a structured before/after
 * diff, shape TBD. The audit-write path is why maxDuration is bumped to 30s in
 * vercel.json. TODO(R12): finalise the `changes` shape and index strategy.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id"),
  // e.g. "task.updated" — TODO(R12): enumerate actions.
  action: text("action").notNull(),
  // Target entity type + id, e.g. { type: "task", id: "…" }.
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  changes: jsonb("changes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
