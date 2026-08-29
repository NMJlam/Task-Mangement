import { z } from "zod";

/**
 * Task shapes for the R7 task endpoints. Mirrors the `tasks` table as it exists
 * today (`backend/src/db/schema/tasks.ts`) — the richer column set in the data
 * model document (priority, tag, order_index, completed_at) is NOT modelled here
 * because those columns do not exist yet; adding them is a migration, not a
 * schema edit.
 *
 * `taskStatusSchema` must stay in step with the `task_status` pgEnum.
 */
export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

const titleSchema = z.string().trim().min(1, "Title is required").max(200);
const descriptionSchema = z.string().trim().max(2000).nullish();

export const taskSchema = z.object({
  id: z.uuid(),
  teamId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  assigneeId: z.uuid().nullable(),
  dueAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type Task = z.infer<typeof taskSchema>;

/** Route params for every /tasks/:id endpoint. */
export const taskParamsSchema = z.object({ id: z.uuid() });

// ── POST /api/tasks ──────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  teamId: z.uuid(),
  title: titleSchema,
  description: descriptionSchema,
  status: taskStatusSchema.default("todo"),
  assigneeId: z.uuid().nullish(),
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
    title: titleSchema.optional(),
    description: descriptionSchema,
    status: taskStatusSchema.optional(),
    assigneeId: z.uuid().nullish(),
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
  assigneeId: z.uuid().optional(),
  ...paginationShape,
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** Overdue is derived (`status <> 'done' AND due_at < now()`), never stored,
 * so this query takes no `status` filter. */
export const overdueTasksQuerySchema = z.object({
  teamId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  ...paginationShape,
});

export type OverdueTasksQuery = z.infer<typeof overdueTasksQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const taskResponseSchema = z.object({ task: taskSchema });
export const taskListResponseSchema = z.object({ tasks: z.array(taskSchema) });

export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
