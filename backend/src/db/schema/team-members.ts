import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { users } from "./users.js";

/** Join table: which users belong to which teams. TODO(R5): per-team role. */
export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);
