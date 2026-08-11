import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";

export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);

/** A task retained for R7; app-user assignment is deferred with that requirement. */
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatus("status").notNull().default("todo"),
  assigneeId: uuid("assignee_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
