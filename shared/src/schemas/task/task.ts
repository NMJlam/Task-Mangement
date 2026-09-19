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
 * (`backend/src/db/schema/task.ts`) column for column, except for assignment:
 * R3 makes a task multi-assignee, so the set lives in the `task_assignee`
 * junction and every read assembles it — the route never returns a bare `.select()`.
 *
 * Field names follow the table, not the wire convention of the earlier draft:
 * the column is `creator`, not `creator_id`.
 */
const titleSchema = z.string().trim().min(1, "Title is required").max(200);
// Postgres accepts every UUID-shaped value, including legacy rows whose
// version/variant bits predate the stricter RFC check in z.uuid().
const storedTaskIdSchema = z.guid();

/**
 * Optional free-form detail. Normalised to `null` so "no description" has one
 * representation instead of two (`null` and `""`), which is what lets the
 * dialog test emptiness with a single check.
 */
const descriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description is too long")
  .transform((value) => (value === "" ? null : value));

/**
 * Ownership is an unordered set (R3), so a repeated id is a client bug rather
 * than a second assignment, and the array collapses to first-seen order. One
 * schema for all three positions — response, create, update — so dedup cannot
 * be forgotten on one path.
 */
const assigneeIdsSchema = z.array(z.uuid()).transform((ids) => [...new Set(ids)]);

export const taskSchema = z.object({
  id: storedTaskIdSchema,
  // Both parents nullable: standing committee work belongs to no event,
  // cross-cutting work belongs to no team.
  eventId: z.uuid().nullable(),
  teamId: z.uuid().nullable(),
  assigneeIds: assigneeIdsSchema,
  creator: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
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
export const taskParamsSchema = z.object({ id: storedTaskIdSchema });

// ── POST /api/tasks ──────────────────────────────────────────────────────────

/**
 * `creator` is not accepted from the client — the route stamps it from the
 * session, so a caller cannot attribute work to someone else. `boardOrder` and
 * `minTier` keep their column defaults until the board endpoints land (R8).
 *
 * `eventId` links the task to an event. Paired with a `teamId`, the route
 * declares that team's workstream on the event if it has none yet — see
 * `backend/src/routes/tasks/service.ts`.
 *
 * `assigneeIds` defaults to `[]`: a task with no owner is legal, and the create
 * body omits it more often than not.
 */
export const createTaskSchema = z.object({
  eventId: z.uuid().nullish(),
  teamId: z.uuid().nullish(),
  title: titleSchema,
  description: descriptionSchema.nullish(),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("medium"),
  assigneeIds: assigneeIdsSchema.default([]),
  dueAt: z.coerce.date().nullish(),
});

export type CreateTask = z.infer<typeof createTaskSchema>;

// ── PATCH /api/tasks/:id ─────────────────────────────────────────────────────

/**
 * Every field optional, but at least one must be present — an empty patch is a
 * client bug, not a no-op, so it 422s rather than silently returning the row.
 *
 * `assigneeIds` is the one field where omission and emptiness differ: omitting
 * it leaves the assignments alone, `[]` clears them. The route replaces the
 * whole set, it never merges into it.
 */
export const updateTaskSchema = z
  .object({
    eventId: z.uuid().nullish(),
    teamId: z.uuid().nullish(),
    title: titleSchema.optional(),
    description: descriptionSchema.nullish(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeIds: assigneeIdsSchema.optional(),
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
  eventId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assignee: z.uuid().optional(),
  ...paginationShape,
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** Overdue is derived (`status <> 'done' AND due_at < now()`), never stored,
 * so this query takes no `status` filter. `priority` is orthogonal to that
 * derivation and therefore belongs here. */
export const overdueTasksQuerySchema = z.object({
  eventId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  assignee: z.uuid().optional(),
  priority: taskPrioritySchema.optional(),
  ...paginationShape,
});

export type OverdueTasksQuery = z.infer<typeof overdueTasksQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const taskResponseSchema = z.object({ task: taskSchema });
export const taskListResponseSchema = z.object({ tasks: z.array(taskSchema) });

export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
