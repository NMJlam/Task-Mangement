import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";

/** Join table retained for R5; app-user linking is deferred with that requirement. */
export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);
