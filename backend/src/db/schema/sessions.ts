import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

/** Legacy session stub retained until its deferred cleanup requirement lands. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
