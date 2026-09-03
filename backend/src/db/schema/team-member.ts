import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { teams } from "./team.js";

/**
 * Plain many-to-many. CASCADE on both sides: a membership row with no team or
 * no member is garbage, not history.
 */
export const teamMembers = pgTable(
  "team_member",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    // Hot read: "which teams am I in", on every page load for the sidebar.
    // The primary key serves (team -> members); this serves (member -> teams).
    index("team_member_user_idx").on(table.userId),
  ],
);
