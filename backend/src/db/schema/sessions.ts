import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/** Server-side sessions (SESSION_TTL_HOURS). TODO(R2): session token strategy. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
