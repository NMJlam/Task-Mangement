import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** A team within the club. TODO(R5): description, and club scoping if multi-club. */
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
