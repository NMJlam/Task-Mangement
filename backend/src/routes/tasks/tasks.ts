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
import { and, asc, desc, eq, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, events, taskAssignees, tasks, teams } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import { visibleEvents, type Queryable, type Tx } from "../events/service.js";
import {
  assembleTasks,
  ensureWorkstreams,
  mergeLink,
  reorderColumn,
  workstreamKeys,
} from "./service.js";

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

type Reference = {
  eventId?: string | null;
  teamId?: string | null;
  assigneeIds?: readonly string[];
};

/**
 * Resolve the foreign keys before writing.
 *
 * `task.event_id`, `task.team_id` and `task_assignee.user_id` are all
 * FK-constrained, so an unknown id would otherwise surface as an opaque 500
 * from Postgres. Checking them here turns each into a 422 that names the
 * offending field.
 *
 * An event must also be one the caller can see. Above their tier or cancelled
 * (the soft delete) reads as missing, as on every event route — a different
 * code would confirm the event exists.
 */
async function findBadReference(
  db: Queryable,
  references: Reference[],
  tier: Tier,
): Promise<{ code: string; message: string } | undefined> {
  const eventIds = [...new Set(references.map((reference) => reference.eventId).filter(isId))];
  const teamIds = [...new Set(references.map((reference) => reference.teamId).filter(isId))];
  // Every array in the batch flattens into one membership check — a bulk create
  // sending the same member on fifty tasks is one id to look up, not fifty.
  const assignees = [...new Set(references.flatMap((reference) => reference.assigneeIds ?? []))];

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

/**
 * The `completed_at` half of a move on the board. Unlike `completionOf`, which
 * always stamps, this keeps an existing stamp: a reorder inside Done re-writes
 * the same status, and re-dating finished work is not what the user asked for.
 * Moving into done still stamps it and moving out still clears it, which is the
 * table's `(status = 'done') = (completed_at IS NOT NULL)` rule.
 */
function completionForMove(status: TaskStatus): { completedAt: SQL } {
  return {
    completedAt: sql`CASE WHEN ${status} = 'done' THEN COALESCE(${tasks.completedAt}, now()) ELSE NULL END`,
  };
}

/**
 * The `overdue_escalated_at` half of a task update — which writes start a new
 * overdue cycle (see the column's note in `db/schema/task.ts`).
 *
 * A deadline that moved (or was cleared) resets the marker outright. A reopen
 * resets it too, but only from a STORED `done`: the `CASE` reads the row's own
 * status inside the UPDATE, so no preliminary SELECT is needed and a concurrent
 * reopen cannot slip between a read and the write.
 *
 * Everything else leaves it alone — an open-to-open move (todo →
 * in_progress), a priority-only edit, and closing a task — which is exactly what
 * lets a user's post-escalation priority override survive the next sweep.
 *
 * The due-date reset takes precedence when a patch moves both fields.
 */
function overdueCycleReset(patch: { dueAt?: Date | null; status?: TaskStatus }): {
  overdueEscalatedAt?: Date | null | SQL;
} {
  if (patch.dueAt !== undefined) return { overdueEscalatedAt: null };
  if (patch.status === undefined || patch.status === "done") return {};
  return {
    overdueEscalatedAt: sql`CASE WHEN ${tasks.status} = 'done' THEN NULL ELSE ${tasks.overdueEscalatedAt} END`,
  };
}

function notFound(res: Response): void {
  res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
}

// ── The junction, in and out ─────────────────────────────────────────────────

/** `EXISTS` a `task_assignee` row putting `userId` on the task being filtered. */
function assignedTo(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id} AND ${taskAssignees.userId} = ${userId})`;
}

/**
 * Replaces a task's whole assignment set. Delete-then-insert rather than a
 * diff: the submitted array IS the new set, `[]` included, and a diff would
 * leave a co-assignee the caller dropped.
 *
 * The ids arrive already deduplicated by `assigneeIdsSchema`, so both
 * statements stay safe on the composite primary key.
 */
async function setAssignees(tx: Tx, taskId: string, userIds: readonly string[]): Promise<void> {
  await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (userIds.length > 0) {
    await tx.insert(taskAssignees).values(userIds.map((userId) => ({ taskId, userId })));
  }
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
      const db = getDb();
      const filters = [
        query.eventId ? eq(tasks.eventId, query.eventId) : undefined,
        query.teamId ? eq(tasks.teamId, query.teamId) : undefined,
        query.status ? eq(tasks.status, query.status) : undefined,
        query.priority ? eq(tasks.priority, query.priority) : undefined,
        // `assignee=` is membership, not identity: a multi-assignee task comes
        // back once for any member holding it, which EXISTS guarantees.
        query.assignee ? assignedTo(query.assignee) : undefined,
      ].filter((filter): filter is SQL => filter !== undefined);

      const rows = await db
        .select()
        .from(tasks)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(tasks.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      res.status(200).json({ tasks: await assembleTasks(db, rows) } satisfies TaskListResponse);
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
      const db = getDb();
      // Overdue is derived, never stored: past due and not yet done. A NULL
      // due_at is not overdue, and `lt` already excludes it.
      const filters = [
        lt(tasks.dueAt, new Date()),
        ne(tasks.status, "done"),
        query.eventId ? eq(tasks.eventId, query.eventId) : undefined,
        query.teamId ? eq(tasks.teamId, query.teamId) : undefined,
        query.priority ? eq(tasks.priority, query.priority) : undefined,
        query.assignee ? assignedTo(query.assignee) : undefined,
      ].filter((filter): filter is SQL => filter !== undefined);

      const rows = await db
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(asc(tasks.dueAt))
        .limit(query.limit)
        .offset(query.offset);

      res.status(200).json({ tasks: await assembleTasks(db, rows) } satisfies TaskListResponse);
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
      const { assigneeIds, ...columns } = input;
      const task = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(tasks)
          .values({
            id: newId(),
            creator: req.user!.id,
            ...columns,
            ...completionOf(input.status),
          })
          .returning();
        await setAssignees(tx, row!.id, assigneeIds);
        return (await assembleTasks(tx, [row!]))[0]!;
      });

      res.status(201).json({ task } satisfies TaskResponse);
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

      // One multi-row INSERT rather than one per task: it is atomic on its own
      // and works identically on the node and Neon serverless drivers. The
      // junction rows join the same transaction so no task lands unowned.
      const rows = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(tasks)
          .values(
            input.tasks.map(({ assigneeIds: _assigneeIds, ...task }) => ({
              id: newId(),
              creator: req.user!.id,
              ...task,
              ...completionOf(task.status),
            })),
          )
          .returning();
        const links = inserted.flatMap((row, index) =>
          (input.tasks[index]!.assigneeIds ?? []).map((userId) => ({ taskId: row.id, userId })),
        );
        if (links.length > 0) {
          await tx.insert(taskAssignees).values(links).onConflictDoNothing();
        }
        return assembleTasks(tx, inserted);
      });

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
      res
        .status(200)
        .json({ task: (await assembleTasks(getDb(), [task]))[0]! } satisfies TaskResponse);
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

      // `assigneeIds` is a second table, so it cannot ride along in the UPDATE
      // above; the task row and the junction move in one transaction, which is
      // also what makes the submitted array replace the set atomically.
      const { assigneeIds, ...columns } = patch;
      const task = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(tasks)
          .set({
            ...columns,
            // No `updated_at` trigger exists, so the route owns the timestamp.
            ...(columns.status ? completionOf(columns.status) : {}),
            // A moved deadline or a reopen, in the same statement — see
            // `overdueCycleReset`.
            ...overdueCycleReset(columns),
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, req.params.id!))
          .returning();

        if (!row) return undefined;
        if (assigneeIds !== undefined) {
          await setAssignees(tx, row.id, assigneeIds);
        }
        return (await assembleTasks(tx, [row]))[0];
      });

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

/**
 * Moves a card: the status is the column it belongs to, and the optional `after`
 * anchor is the slot within that column. Omitting `after` is the pure status
 * change this endpoint has always been and leaves the stored slot alone.
 *
 * A reorder is not a completion, so the destination column is renumbered inside
 * the same transaction as the status write, and `completed_at` is kept rather
 * than re-stamped for a card that was already done. The column is every task of
 * that status, whichever event it belongs to — see `reorderColumn`.
 */
tasksRouter.patch(
  "/tasks/:id/status",
  authenticate,
  authorise(0),
  validate(taskParamsSchema, "params"),
  validate(changeTaskStatusSchema),
  async (req, res, next) => {
    try {
      const { status, after } = res.locals.validated as ChangeTaskStatus;
      const task = await getDb().transaction(async (tx) => {
        const [row] = await tx
          .update(tasks)
          .set({
            status,
            ...completionForMove(status),
            // Reopening clears the escalation marker; the other three moves do not.
            ...overdueCycleReset({ status }),
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, req.params.id!))
          .returning();

        if (!row) return undefined;
        if (after === undefined) return (await assembleTasks(tx, [row]))[0];

        await reorderColumn(tx, { id: row.id, status: row.status }, after);
        // Read back, because the UPDATE above returned the slot the card held
        // before the renumber, not the one it has just landed in.
        const [moved] = await tx.select().from(tasks).where(eq(tasks.id, row.id)).limit(1);
        return (await assembleTasks(tx, [moved ?? row]))[0];
      });

      if (!task) {
        notFound(res);
        return;
      }
      // Status touches the task row alone, so the set is read back, not written.
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
