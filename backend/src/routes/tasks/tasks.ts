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
  type Tier,
  type UpdateTask,
} from "@ctp/shared";
import { and, asc, desc, eq, inArray, lt, ne, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, events, tasks, teams } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import { visibleEvents } from "../events/service.js";
import { ensureWorkstreams, mergeLink, workstreamKeys } from "./service.js";

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

type Reference = { eventId?: string | null; teamId?: string | null; assignee?: string | null };

/**
 * Resolve the foreign keys before writing.
 *
 * `task.event_id`, `task.team_id` and `task.assignee` are all FK-constrained, so
 * an unknown id would otherwise surface as an opaque 500 from Postgres. Checking
 * them here turns each into a 422 that names the offending field.
 *
 * An event must also be one the caller can see. Above their tier or cancelled
 * (the soft delete) reads as missing, as on every event route — a different
 * code would confirm the event exists.
 */
async function findBadReference(
  db: ReturnType<typeof getDb>,
  references: Reference[],
  tier: Tier,
): Promise<{ code: string; message: string } | undefined> {
  const eventIds = [...new Set(references.map((reference) => reference.eventId).filter(isId))];
  const teamIds = [...new Set(references.map((reference) => reference.teamId).filter(isId))];
  const assignees = [...new Set(references.map((reference) => reference.assignee).filter(isId))];

  if (eventIds.length > 0) {
    const found = await db
      .select({ id: events.id })
      .from(events)
      .where(and(inArray(events.id, eventIds), visibleEvents(tier)));
    const missing = eventIds.find((id) => !found.some((row) => row.id === id));
    if (missing) return { code: "EVENT_NOT_FOUND", message: `No event with id ${missing}.` };
  }

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
        query.eventId ? eq(tasks.eventId, query.eventId) : undefined,
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
        query.eventId ? eq(tasks.eventId, query.eventId) : undefined,
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
      const bad = await findBadReference(db, [input], req.user!.tier);
      if (bad) {
        res.status(422).json({ error: bad });
        return;
      }

      await ensureWorkstreams(db, workstreamKeys([input]));

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
      const bad = await findBadReference(db, input.tasks, req.user!.tier);
      if (bad) {
        res.status(422).json({ error: bad });
        return;
      }

      await ensureWorkstreams(db, workstreamKeys(input.tasks));

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
      const bad = await findBadReference(db, [patch], req.user!.tier);
      if (bad) {
        res.status(422).json({ error: bad });
        return;
      }

      // Moving either side of the link can land the task on a pair with no
      // workstream — a new team on the same event is the common case — so work
      // out the link the row will end up with and declare it before the update.
      if (patch.eventId !== undefined || patch.teamId !== undefined) {
        const [stored] = await db
          .select({ eventId: tasks.eventId, teamId: tasks.teamId })
          .from(tasks)
          .where(eq(tasks.id, req.params.id!))
          .limit(1);
        if (!stored) {
          notFound(res);
          return;
        }
        await ensureWorkstreams(db, workstreamKeys([mergeLink(stored, patch)]));
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
