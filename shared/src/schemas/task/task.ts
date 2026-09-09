import { z } from "zod";

/**
 * Task vocabulary. Defined here once (§1.2) and imported by BOTH the frontend
 * board and the Drizzle schema, which generates its SQL CHECK constraints from
 * `.options` — see `backend/src/db/schema/task.ts`. Adding a value here is the
 * only edit needed on the application side; the database follows on the next
 * `db:generate`.
 */
/**
 * `blocked` earns its place: it is the signal that someone is waiting on
 * someone else, which is the failure mode a volunteer committee actually
 * suffers from. Without it a stalled task sits in `in_progress` looking healthy.
 */
export const taskStatusSchema = z.enum(["todo", "in_progress", "blocked", "done"]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/**
 * Task shapes for the R7 task endpoints. Mirrors the `task` table
 * (`backend/src/db/schema/task.ts`) column for column, so a bare `.select()`
 * satisfies `taskSchema` without a projection step.
 *
 * Field names follow the table, not the wire convention of the earlier draft:
 * the column is `assignee`, not `assignee_id`, because it pairs with `creator`
 * and the two answer different questions.
 */
const titleSchema = z.string().trim().min(1, "Title is required").max(200);

export const taskSchema = z.object({
  id: z.uuid(),
  // Both parents nullable: standing committee work belongs to no event,
  // cross-cutting work belongs to no team.
  eventId: z.uuid().nullable(),
  teamId: z.uuid().nullable(),
  assignee: z.uuid().nullable(),
  creator: z.uuid().nullable(),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueAt: z.coerce.date().nullable(),
  boardOrder: z.number().int(),
  minTier: z.number().int(),
  // Derived from status by the route, never sent by the client: the table
  // enforces `(status = 'done') = (completed_at IS NOT NULL)`.
  completedAt: z.coerce.date().nullable(),
  aiRunId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Task = z.infer<typeof taskSchema>;

/** Route params for every /tasks/:id endpoint. */
export const taskParamsSchema = z.object({ id: z.uuid() });

// ── POST /api/tasks ──────────────────────────────────────────────────────────

/**
 * `creator` is not accepted from the client — the route stamps it from the
 * session, so a caller cannot attribute work to someone else. `boardOrder`,
 * `minTier` and `eventId` keep their column defaults until the board and
 * workstream endpoints land (R8).
 */
export const createTaskSchema = z.object({
  teamId: z.uuid().nullish(),
  title: titleSchema,
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("medium"),
  assignee: z.uuid().nullish(),
  dueAt: z.coerce.date().nullish(),
});

export type CreateTask = z.infer<typeof createTaskSchema>;

// ── PATCH /api/tasks/:id ─────────────────────────────────────────────────────

/**
 * Every field optional, but at least one must be present — an empty patch is a
 * client bug, not a no-op, so it 422s rather than silently returning the row.
 */
export const updateTaskSchema = z
  .object({
    teamId: z.uuid().nullish(),
    title: titleSchema.optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assignee: z.uuid().nullish(),
    dueAt: z.coerce.date().nullish(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateTask = z.infer<typeof updateTaskSchema>;

// ── PATCH /api/tasks/:id/status ──────────────────────────────────────────────

export const changeTaskStatusSchema = z.object({ status: taskStatusSchema });

export type ChangeTaskStatus = z.infer<typeof changeTaskStatusSchema>;

// ── POST /api/tasks/bulk ─────────────────────────────────────────────────────

/**
 * Bulk create. Capped at 100 so one request cannot build an unbounded INSERT;
 * the whole batch is written in a single statement, so it is all-or-nothing.
 */
export const bulkCreateTasksSchema = z.object({
  tasks: z.array(createTaskSchema).min(1, "Provide at least one task").max(100),
});

export type BulkCreateTasks = z.infer<typeof bulkCreateTasksSchema>;

// ── GET /api/tasks and GET /api/tasks/overdue ────────────────────────────────

const paginationShape = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const listTasksQuerySchema = z.object({
  teamId: z.uuid().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee: z.uuid().optional(),
  ...paginationShape,
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** Overdue is derived (`status <> 'done' AND due_at < now()`), never stored,
 * so this query takes no `status` filter. */
export const overdueTasksQuerySchema = z.object({
  teamId: z.uuid().optional(),
  assignee: z.uuid().optional(),
  ...paginationShape,
});

export type OverdueTasksQuery = z.infer<typeof overdueTasksQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const taskResponseSchema = z.object({ task: taskSchema });
export const taskListResponseSchema = z.object({ tasks: z.array(taskSchema) });

export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
