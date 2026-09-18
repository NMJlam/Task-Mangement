import { check, index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { uuidShape } from "./sql-uuid.js";
import { tasks } from "./task.js";

/**
 * Plain many-to-many, like `team_member`. R3 says a task is multi-assignee, so
 * ownership is a set — there is no primary assignee and no ordering. CASCADE on
 * both sides: a link with no task or no member is garbage, not history.
 */
export const taskAssignees = pgTable(
  "task_assignee",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    // Hot read: "my open work", on the dashboard and the task list. The primary
    // key serves (task -> assignees); this serves (member -> tasks). The old
    // partial index on `status <> 'done'` cannot come along — a junction index
    // cannot reference `task.status`.
    index("task_assignee_user_idx").on(table.userId),
    check("task_assignee_uuid_shape_check", uuidShape(table.taskId, table.userId)),
  ],
);
