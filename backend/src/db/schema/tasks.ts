import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { users } from "./users.js";

// TODO(R7): confirm the status set against the RTM / board columns.
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);

/** A task assignable within a team. TODO(R7): priority, labels, ordering. */
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatus("status").notNull().default("todo"),
  assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
