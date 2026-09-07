import {
  bulkCreateTasksSchema,
  changeTaskStatusSchema,
  createTaskSchema,
  listTasksQuerySchema,
  overdueTasksQuerySchema,
  taskParamsSchema,
  updateTaskSchema,
  type BulkCreateTasks,
  type ChangeTaskStatus,
  type CreateTask,
  type ListTasksQuery,
  type OverdueTasksQuery,
  type TaskListResponse,
  type TaskResponse,
  type TaskStatus,
  type UpdateTask,
} from "@ctp/shared";
import { and, asc, desc, eq, inArray, lt, ne, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, tasks, teams } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const tasksRouter = Router();

/**
 * Task CRUD (R7).
 *
 * Tier gates use the existing tier axis only — reads and day-to-day edits are
 * open to any member (tier 0); the two blast-radius endpoints, DELETE and the
 * bulk insert, require tier >= 1. No new capability is added to `CAPABILITIES`,
 * because that map is the source of the role-diff UI and should only grow when a
 * role-bound power actually exists (plan.md, watch-out 4).
 */

type Reference = { teamId?: string | null; assignee?: string | null };

/**
 * Resolve the foreign keys before writing.
 *
 * Both `task.team_id` and `task.assignee` are FK-constrained, so an unknown id
 * would otherwise surface as an opaque 500 from Postgres. Checking them here
 * turns either into a 422 that names the offending field.
 */
async function findBadReference(
  db: ReturnType<typeof getDb>,
  references: Reference[],
): Promise<{ code: string; message: string } | undefined> {
  const teamIds = [...new Set(references.map((reference) => reference.teamId).filter(isId))];
  const assignees = [...new Set(references.map((reference) => reference.assignee).filter(isId))];

  if (teamIds.length > 0) {
    const found = await db.select({ id: teams.id }).from(teams).where(inArray(teams.id, teamIds));
    const missing = teamIds.find((id) => !found.some((row) => row.id === id));
    if (missing) return { code: "TEAM_NOT_FOUND", message: `No team with id ${missing}.` };
  }

  if (assignees.length > 0) {
    const found = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(inArray(appUsers.id, assignees));
    const missing = assignees.find((id) => !found.some((row) => row.id === id));
    if (missing) return { code: "ASSIGNEE_NOT_FOUND", message: `No member with id ${missing}.` };
  }

  return undefined;
}

function isId(value: string | null | undefined): value is string {
  return typeof value === "string";
}

/**
 * `completed_at` is derived from status, never supplied by the client: the
 * table enforces `(status = 'done') = (completed_at IS NOT NULL)`, so writing a
 * status without its timestamp trips the CHECK and 500s.
 */
function completionOf(status: TaskStatus): { completedAt: Date | null } {
  return { completedAt: status === "done" ? new Date() : null };
}

function notFound(res: Response): void {
  res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
}

// ── GET /api/tasks ───────────────────────────────────────────────────────────

tasksRouter.get(
  "/tasks",
  authenticate,
  authorise(0),
  validate(listTasksQuerySchema, "query"),
  async (_req, res, next) => {
    try {
      const query = res.locals.validated as ListTasksQuery;
      const filters = [
        query.teamId ? eq(tasks.teamId, query.teamId) : undefined,
        query.status ? eq(tasks.status, query.status) : undefined,
        query.priority ? eq(tasks.priority, query.priority) : undefined,
        query.assignee ? eq(tasks.assignee, query.assignee) : undefined,
      ].filter((filter): filter is SQL => filter !== undefined);

      const rows = await getDb()
        .select()
        .from(tasks)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(tasks.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      res.status(200).json({ tasks: rows } satisfies TaskListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /api/tasks/overdue ───────────────────────────────────────────────────
// MUST be declared before "/tasks/:id" — both are two-segment GETs, so ":id"
// would otherwise capture the literal "overdue" and 422 on the uuid check.

tasksRouter.get(
  "/tasks/overdue",
  authenticate,
  authorise(0),
  validate(overdueTasksQuerySchema, "query"),
  async (_req, res, next) => {
    try {
      const query = res.locals.validated as OverdueTasksQuery;
      // Overdue is derived, never stored: past due and not yet done. A NULL
      // due_at is not overdue, and `lt` already excludes it.
      const filters = [
        lt(tasks.dueAt, new Date()),
        ne(tasks.status, "done"),
        query.teamId ? eq(tasks.teamId, query.teamId) : undefined,
        query.assignee ? eq(tasks.assignee, query.assignee) : undefined,
      ].filter((filter): filter is SQL => filter !== undefined);

      const rows = await getDb()
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(asc(tasks.dueAt))
        .limit(query.limit)
        .offset(query.offset);

      res.status(200).json({ tasks: rows } satisfies TaskListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/tasks ──────────────────────────────────────────────────────────

tasksRouter.post(
  "/tasks",
  authenticate,
  authorise(0),
  validate(createTaskSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateTask;
      const db = getDb();
      const bad = await findBadReference(db, [input]);
      if (bad) {
        res.status(422).json({ error: bad });
        return;
      }

      // `creator` is stamped from the session, never the body, so a caller
      // cannot attribute work to someone else.
      const [task] = await db
        .insert(tasks)
        .values({
          id: newId(),
          creator: req.user!.id,
          ...input,
          ...completionOf(input.status),
        })
        .returning();

      res.status(201).json({ task: task! } satisfies TaskResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/tasks/bulk ─────────────────────────────────────────────────────

tasksRouter.post(
  "/tasks/bulk",
  authenticate,
  authorise(1),
  validate(bulkCreateTasksSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as BulkCreateTasks;
      const db = getDb();
      const bad = await findBadReference(db, input.tasks);
      if (bad) {
        res.status(422).json({ error: bad });
        return;
      }

      // One multi-row INSERT rather than a transaction: it is atomic on its own
      // and works identically on the node and Neon HTTP drivers.
      const rows = await db
        .insert(tasks)
        .values(
          input.tasks.map((task) => ({
            id: newId(),
            creator: req.user!.id,
            ...task,
            ...completionOf(task.status),
          })),
        )
        .returning();

      res.status(201).json({ tasks: rows } satisfies TaskListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /api/tasks/:id ───────────────────────────────────────────────────────

tasksRouter.get(
  "/tasks/:id",
  authenticate,
  authorise(0),
  validate(taskParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const [task] = await getDb()
        .select()
        .from(tasks)
        .where(eq(tasks.id, req.params.id!))
        .limit(1);

      if (!task) {
        notFound(res);
        return;
      }
      res.status(200).json({ task } satisfies TaskResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── PATCH /api/tasks/:id ─────────────────────────────────────────────────────

tasksRouter.patch(
  "/tasks/:id",
  authenticate,
  authorise(0),
  validate(taskParamsSchema, "params"),
  validate(updateTaskSchema),
  async (req, res, next) => {
    try {
      const patch = res.locals.validated as UpdateTask;
      const db = getDb();
      const bad = await findBadReference(db, [patch]);
      if (bad) {
        res.status(422).json({ error: bad });
        return;
      }

      // No `updated_at` trigger exists, so the route owns the timestamp.
      const [task] = await db
        .update(tasks)
        .set({
          ...patch,
          ...(patch.status ? completionOf(patch.status) : {}),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, req.params.id!))
        .returning();

      if (!task) {
        notFound(res);
        return;
      }
      res.status(200).json({ task } satisfies TaskResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── PATCH /api/tasks/:id/status ──────────────────────────────────────────────

tasksRouter.patch(
  "/tasks/:id/status",
  authenticate,
  authorise(0),
  validate(taskParamsSchema, "params"),
  validate(changeTaskStatusSchema),
  async (req, res, next) => {
    try {
      const { status } = res.locals.validated as ChangeTaskStatus;
      const [task] = await getDb()
        .update(tasks)
        .set({ status, ...completionOf(status), updatedAt: new Date() })
        .where(eq(tasks.id, req.params.id!))
        .returning();

      if (!task) {
        notFound(res);
        return;
      }
      res.status(200).json({ task } satisfies TaskResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── DELETE /api/tasks/:id ────────────────────────────────────────────────────

tasksRouter.delete(
  "/tasks/:id",
  authenticate,
  authorise(1),
  validate(taskParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const [task] = await getDb()
        .delete(tasks)
        .where(eq(tasks.id, req.params.id!))
        .returning({ id: tasks.id });

      if (!task) {
        notFound(res);
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
