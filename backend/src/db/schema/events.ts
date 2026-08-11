import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";

/** A calendar event for a team. TODO(R9): location, recurrence, attendees. */
export const events = pgTable("events", {
  id: uuid("id").primaryKey(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
