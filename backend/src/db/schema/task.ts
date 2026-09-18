import {
  taskPrioritySchema,
  taskStatusSchema,
  type TaskPriority,
  type TaskStatus,
} from "@ctp/shared";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { aiRuns } from "./ai-run.js";
import { appUsers } from "./app-user.js";
import { events } from "./event.js";
import { notBlank, sqlEnumValues } from "./sql-enum.js";
import { uuidShape } from "./sql-uuid.js";
import { teams } from "./team.js";
import { workstreams } from "./workstream.js";

export const tasks = pgTable(
  "task",
  {
    id: uuid("id").primaryKey(),

    // Both parents nullable: standing committee work belongs to no event,
    // cross-cutting work belongs to no team.
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),

    // `creator` stays the human: it answers "who asked for this", while "my
    // work" is the unordered `task_assignee` set (R3 — multi-assignee).
    creator: uuid("creator").references(() => appUsers.id, { onDelete: "set null" }),

    title: text("title").notNull(),

    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    priority: text("priority").$type<TaskPriority>().notNull().default("medium"),

    dueAt: timestamp("due_at", { withTimezone: true }),

    // Explicit integer because a Kanban board is draggable and sorting by date
    // is not. Renumber the affected column in one transaction per move.
    // Contiguous per (event_id, status); a NULL event_id forms the single
    // standing board. If renumbering is outgrown, fractional ranking keys are
    // the upgrade.
    boardOrder: integer("board_order").notNull().default(0),

    minTier: smallint("min_tier").notNull().default(0),

    completedAt: timestamp("completed_at", { withTimezone: true }),

    // The one line of AI provenance: "which tasks did the assistant create?".
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Hot read: the board for one event, in column order. Also serves the
    // standing board, since NULLs are indexed and event_id leads the key.
    index("task_board_idx").on(table.eventId, table.status, table.boardOrder),

    // Overdue is never a stored flag — a stored flag is wrong every midnight.
    // It is status <> 'done' AND due_at < now(), and this serves it.
    index("task_overdue_idx")
      .on(table.dueAt)
      .where(sql`${table.status} <> 'done' AND ${table.dueAt} IS NOT NULL`),

    // The GET /api/calendar task range read, filtered by team.
    index("task_team_due_idx").on(table.teamId, table.dueAt),

    check("task_title_not_blank_check", notBlank(table.title)),
    check(
      "task_status_check",
      sql`${table.status} IN (${sqlEnumValues(taskStatusSchema.options)})`,
    ),
    check(
      "task_priority_check",
      sql`${table.priority} IN (${sqlEnumValues(taskPrioritySchema.options)})`,
    ),
    check("task_min_tier_range_check", sql`${table.minTier} BETWEEN 0 AND 2`),

    // Prose conventions drift; constraints can't.
    check(
      "task_completed_at_matches_status_check",
      sql`(${table.status} = 'done') = (${table.completedAt} IS NOT NULL)`,
    ),

    // A task cannot land in a workstream nobody declared. MATCH SIMPLE is the
    // SQL default, so a NULL in either column skips the check entirely — which
    // is what keeps standing tasks and event-wide tasks legal.
    //
    // The task routes declare the workstream on first use
    // (`routes/tasks/service.ts`), so the API never trips this; only a direct
    // insert can.
    //
    // NOTE: this is ON DELETE CASCADE, so deleting a workstream would take its
    // tasks with it. Rule 10 guards that in the service layer.
    foreignKey({
      columns: [table.eventId, table.teamId],
      foreignColumns: [workstreams.eventId, workstreams.teamId],
      name: "task_within_declared_workstream",
    }).onDelete("cascade"),

    check(
      "task_uuid_shape_check",
      uuidShape(table.id, table.eventId, table.teamId, table.creator, table.aiRunId),
    ),
  ],
);
