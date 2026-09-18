import {
  calendarQuerySchema,
  can,
  changeEventStatusSchema,
  createEventSchema,
  eventCursorSchema,
  eventParamsSchema,
  getEventQuerySchema,
  listEventsQuerySchema,
  updateEventSchema,
  type CalendarItem,
  type CalendarQuery,
  type CalendarResponse,
  type ChangeEventStatus,
  type ChangeEventStatusResponse,
  type CreateEvent,
  type EventBudget,
  type EventDetail,
  type EventProgress,
  type EventResponse,
  type EventStatus,
  type EventSummary,
  type GetEventQuery,
  type ListEventsQuery,
  type ListEventsResponse,
  type TaskCounts,
  type Tier,
  type UpdateEvent,
} from "@ctp/shared";
import { and, asc, eq, exists, gt, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
  appUsers,
  auditLog,
  channels,
  events,
  notifications,
  taskAssignees,
  tasks,
  teams,
  workstreams,
} from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import { assembleTasks } from "../tasks/service.js";
import {
  allowedFromStatuses,
  allocateToEvent,
  assertEventDates,
  assertNoTierEscalation,
  BudgetExceededError,
  cancelBlockers,
  releaseAllocation,
  computeProgress,
  ValidationError,
  wrapBlockers,
  type Queryable,
  type Tx,
} from "./service.js";

export const eventsRouter = Router();

function validationErrorResponse(res: Response, error: ValidationError): void {
  res.status(422).json({
    error: { code: "VALIDATION_ERROR", message: "Request validation failed", fields: error.fields },
  });
}

async function audit(
  tx: Queryable,
  actorId: string,
  action: string,
  eventId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(),
    actorId,
    action,
    entityType: "event",
    entityId: eventId,
    changes,
  });
}

/** Fans a notification out to every distinct assignee of the event's tasks. */
async function notifyAssignees(
  tx: Tx,
  eventId: string,
  kind: "event_date_changed" | "event_cancelled",
  body: string,
): Promise<void> {
  const assigneeRows = await tx
    .selectDistinct({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .where(and(eq(tasks.eventId, eventId), ne(tasks.status, "done")));
  const assignees = assigneeRows.map((row) => row.userId);
  if (assignees.length === 0) return;

  await tx.insert(notifications).values(
    assignees.map((userId) => ({
      id: newId(),
      userId,
      kind,
      body,
      entityType: "event",
      entityId: eventId,
    })),
  );
}

function notFound(res: Response): void {
  // Deliberately the same body for "doesn't exist" and "exists but your tier
  // can't see it" — a 403 here would confirm the event exists (plan watch-out).
  res.status(404).json({ error: { code: "EVENT_NOT_FOUND", message: "Event not found." } });
}

// ── The shared per-event row: owner name + task/expense aggregates ─────────
//
// One query serves both GET /events (per row, via LEFT JOIN LATERAL — no
// N+1 on the hottest read in the app) and GET /events/:id (WHERE e.id = $1).
// The owner's display name lives in auth."user", which Drizzle only declares
// `id` for (see schema/auth.ts) — raw SQL is how the rest of the codebase
// already crosses that boundary (authenticate.ts, seed.ts), so this follows
// suit rather than half-typing a cross-schema join.

interface EventRow {
  [key: string]: unknown;
  id: string;
  title: string;
  description: string | null;
  venue: string | null;
  status: EventStatus;
  startsAt: string;
  // Raw driver rows from db.execute() do NOT go through Drizzle's column type
  // mapping the way a typed .select() does — timestamptz columns come back as
  // Postgres's own text representation ("2026-09-18 11:24:30.141+00"), not a
  // JS Date. Every date field below must be run through toDate() before use.
  endsAt: string | null;
  minTier: number;
  allocationCents: string;
  attendanceEstimate: number | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  todo: string;
  inProgress: string;
  blocked: string;
  done: string;
  overdueCount: string;
  committedCents: string;
  spentCents: string;
}

const EVENT_ROW_SELECT = sql`
  SELECT
    e.id, e.title, e.description, e.venue, e.status,
    e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.min_tier AS "minTier",
    e.allocation_cents AS "allocationCents", e.attendance_estimate AS "attendanceEstimate",
    owner_user.id AS "ownerId", owner_auth.name AS "ownerName",
    e.created_at AS "createdAt", e.updated_at AS "updatedAt",
    COALESCE(ta.todo, 0) AS todo,
    COALESCE(ta.in_progress, 0) AS "inProgress",
    COALESCE(ta.blocked, 0) AS blocked,
    COALESCE(ta.done, 0) AS done,
    COALESCE(ta.overdue, 0) AS "overdueCount",
    COALESCE(ea.committed, 0) AS "committedCents",
    COALESCE(ea.spent, 0) AS "spentCents"
  FROM "event" e
  LEFT JOIN "app_user" owner_user ON owner_user.id = e.owner
  LEFT JOIN auth."user" owner_auth ON owner_auth.id = owner_user.auth_user_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE t.status = 'todo') AS todo,
      count(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
      count(*) FILTER (WHERE t.status = 'blocked') AS blocked,
      count(*) FILTER (WHERE t.status = 'done') AS done,
      count(*) FILTER (WHERE t.status <> 'done' AND t.due_at < now()) AS overdue
    FROM "task" t WHERE t.event_id = e.id
  ) ta ON true
  LEFT JOIN LATERAL (
    SELECT
      sum(x.amount_cents) FILTER (WHERE x.status IN ('approved', 'paid')) AS committed,
      sum(x.amount_cents) FILTER (WHERE x.status = 'paid') AS spent
    FROM "expense" x WHERE x.event_id = e.id
  ) ea ON true
`;

function toDate(value: string): Date {
  return new Date(value);
}

function toTaskCounts(row: EventRow): TaskCounts {
  return {
    todo: Number(row.todo),
    inProgress: Number(row.inProgress),
    blocked: Number(row.blocked),
    done: Number(row.done),
  };
}

function toBudget(row: EventRow): EventBudget {
  return {
    allocationCents: Number(row.allocationCents),
    committedCents: Number(row.committedCents),
    spentCents: Number(row.spentCents),
  };
}

function toSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startsAt: toDate(row.startsAt),
    endsAt: row.endsAt ? toDate(row.endsAt) : null,
    venue: row.venue,
    minTier: row.minTier as Tier,
    owner: row.ownerId ? { id: row.ownerId, name: row.ownerName ?? "" } : null,
    taskCounts: toTaskCounts(row),
    overdueCount: Number(row.overdueCount),
    budget: toBudget(row),
  };
}

function toDetail(row: EventRow): EventDetail {
  return {
    ...toSummary(row),
    description: row.description,
    attendanceEstimate: row.attendanceEstimate,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

// ── Keyset cursor: base64 of "startsAt|id" ──────────────────────────────────
// starts_at is not unique, so the pair is the keyset — a starts_at-only
// cursor drops or repeats rows whenever two events share a start time.

function encodeCursor(row: { startsAt: string; id: string }): string {
  return Buffer.from(`${toDate(row.startsAt).toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(raw: string): { startsAt: Date; id: string } | undefined {
  try {
    const [startsAt, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const parsed = eventCursorSchema.safeParse({ startsAt, id });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// ── GET /api/events ──────────────────────────────────────────────────────────

eventsRouter.get(
  "/events",
  authenticate,
  authorise(0),
  validate(listEventsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = res.locals.validated as ListEventsQuery;
      const userTier = req.user!.tier;

      let cursor: { startsAt: Date; id: string } | undefined;
      if (query.cursor) {
        cursor = decodeCursor(query.cursor);
        if (!cursor) {
          res.status(422).json({ error: { code: "INVALID_CURSOR", message: "Bad cursor." } });
          return;
        }
      }

      const filters: SQL[] = [sql`e.min_tier <= ${userTier}`];
      // An explicit status opts in (including "cancelled"); otherwise the
      // default excludes it — cancelled is the soft delete, not a real state
      // most reads want to see.
      filters.push(query.status ? sql`e.status = ${query.status}` : sql`e.status <> 'cancelled'`);
      if (query.teamId) {
        filters.push(
          sql`EXISTS (SELECT 1 FROM "workstream" w WHERE w.event_id = e.id AND w.team_id = ${query.teamId})`,
        );
      }
      if (query.from) filters.push(sql`e.starts_at >= ${query.from}`);
      if (query.to) filters.push(sql`e.starts_at <= ${query.to}`);
      if (query.ownerId) filters.push(sql`e.owner = ${query.ownerId}`);
      if (cursor) {
        filters.push(
          sql`(e.starts_at < ${cursor.startsAt} OR (e.starts_at = ${cursor.startsAt} AND e.id < ${cursor.id}))`,
        );
      }

      // Fetch one extra row to know whether a next page exists, without a
      // separate COUNT query.
      const result = await getDb().execute<EventRow>(sql`
        ${EVENT_ROW_SELECT}
        WHERE ${sql.join(filters, sql` AND `)}
        ORDER BY e.starts_at DESC, e.id DESC
        LIMIT ${query.limit + 1}
      `);

      const hasMore = result.rows.length > query.limit;
      const page = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!) : null;

      res.status(200).json({ items: page.map(toSummary), nextCursor } satisfies ListEventsResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /api/events/:id/progress ─────────────────────────────────────────────
// Declared before "/:id" — harmless here since the two don't collide (:id
// only captures one path segment), but keeping the longer, more specific path
// first matches the convention tasks.ts uses for overdue vs :id.

eventsRouter.get(
  "/events/:id/progress",
  authenticate,
  authorise(0),
  validate(eventParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const result = await getDb().execute<EventRow>(
        sql`${EVENT_ROW_SELECT} WHERE e.id = ${id} LIMIT 1`,
      );
      const row = result.rows[0];
      if (!row || row.minTier > req.user!.tier) {
        notFound(res);
        return;
      }

      const progress = computeProgress({
        startsAt: toDate(row.startsAt),
        createdAt: toDate(row.createdAt),
        allocationCents: Number(row.allocationCents),
        committedCents: Number(row.committedCents),
        taskCounts: toTaskCounts(row),
        overdueCount: Number(row.overdueCount),
      });

      res.status(200).json(progress satisfies EventProgress);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /api/events/:id ───────────────────────────────────────────────────────

eventsRouter.get(
  "/events/:id",
  authenticate,
  authorise(0),
  validate(eventParamsSchema, "params"),
  validate(getEventQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { include } = res.locals.validated as GetEventQuery;
      const id = req.params.id!;
      const db = getDb();

      const result = await db.execute<EventRow>(
        sql`${EVENT_ROW_SELECT} WHERE e.id = ${id} LIMIT 1`,
      );
      const row = result.rows[0];
      if (!row || row.minTier > req.user!.tier) {
        notFound(res);
        return;
      }

      const detail: EventDetail = toDetail(row);

      // TODO(R9): "expenses" is not embeddable yet — no shared expenseSchema
      // row shape exists (see events-calendar-plan.md Phase 0 deviation).
      if (include?.includes("tasks")) {
        detail.tasks = await assembleTasks(
          db,
          await db
            .select()
            .from(tasks)
            .where(and(eq(tasks.eventId, id), lte(tasks.minTier, req.user!.tier)))
            .orderBy(asc(tasks.boardOrder))
            .limit(50),
        );
      }
      if (include?.includes("channel")) {
        const [channel] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(and(eq(channels.kind, "event"), eq(channels.eventId, id)))
          .limit(1);
        if (channel) detail.channelId = channel.id;
      }

      res.status(200).json({ event: detail } satisfies EventResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /api/calendar ─────────────────────────────────────────────────────────

eventsRouter.get(
  "/calendar",
  authenticate,
  authorise(0),
  validate(calendarQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = res.locals.validated as CalendarQuery;
      const userTier = req.user!.tier;
      const include = query.include ?? ["events", "tasks"];
      const db = getDb();
      const items: CalendarItem[] = [];

      if (include.includes("events")) {
        const filters = [
          lte(events.minTier, userTier),
          ne(events.status, "cancelled"),
          gte(events.startsAt, query.from),
          lte(events.startsAt, query.to),
        ];
        if (query.teamId) {
          filters.push(
            exists(
              db
                .select({ one: sql`1` })
                .from(workstreams)
                .where(
                  and(eq(workstreams.eventId, events.id), eq(workstreams.teamId, query.teamId)),
                ),
            ),
          );
        }
        const rows = await db
          .select({
            id: events.id,
            title: events.title,
            startsAt: events.startsAt,
            endsAt: events.endsAt,
            status: events.status,
          })
          .from(events)
          .where(and(...filters))
          .orderBy(asc(events.startsAt));
        for (const row of rows) items.push({ kind: "event", ...row });
      }

      if (include.includes("tasks")) {
        // task.team_id is nullable (standing committee work belongs to no
        // team), so a teamId filter deliberately excludes standing tasks —
        // eq() against NULL never matches.
        const filters = [
          lte(tasks.minTier, userTier),
          gte(tasks.dueAt, query.from),
          lte(tasks.dueAt, query.to),
        ];
        if (query.teamId) filters.push(eq(tasks.teamId, query.teamId));
        const rows = await db
          .select({
            id: tasks.id,
            title: tasks.title,
            dueAt: tasks.dueAt,
            eventId: tasks.eventId,
          })
          .from(tasks)
          .where(and(...filters))
          .orderBy(asc(tasks.dueAt));
        for (const row of await assembleTasks(db, rows)) items.push({ kind: "task", ...row });
      }

      const dateOf = (item: CalendarItem): number =>
        (item.kind === "event" ? item.startsAt : item.dueAt)?.getTime() ?? 0;
      items.sort((a, b) => dateOf(a) - dateOf(b));

      res.status(200).json({ items } satisfies CalendarResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── Helpers shared by the writes below ───────────────────────────────────────

/** Fetches the full response shape (owner, budget, taskCounts, ...) for one event. */
async function fetchEventDetail(eventId: string): Promise<EventDetail | undefined> {
  const result = await getDb().execute<EventRow>(
    sql`${EVENT_ROW_SELECT} WHERE e.id = ${eventId} LIMIT 1`,
  );
  const row = result.rows[0];
  return row ? toDetail(row) : undefined;
}

async function findTeam(
  teamId: string,
): Promise<{ id: string; name: string; lead: string | null } | undefined> {
  const [team] = await getDb().select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return team;
}

// ── POST /api/events ──────────────────────────────────────────────────────────

eventsRouter.post(
  "/events",
  authenticate,
  authorise(1),
  validate(createEventSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateEvent;
      try {
        assertEventDates({ startsAt: input.startsAt, endsAt: input.endsAt ?? null });
      } catch (error) {
        if (error instanceof ValidationError) return validationErrorResponse(res, error);
        throw error;
      }

      if (input.teamId) {
        const team = await findTeam(input.teamId);
        if (!team) {
          res.status(422).json({
            error: { code: "TEAM_NOT_FOUND", message: `No team with id ${input.teamId}.` },
          });
          return;
        }
      }

      const eventId = newId();
      const minTier = input.minTier ?? 0;

      try {
        await getDb().transaction(async (tx) => {
          await tx.insert(events).values({
            id: eventId,
            title: input.title,
            description: input.description ?? null,
            venue: input.venue ?? null,
            startsAt: input.startsAt,
            endsAt: input.endsAt ?? null,
            attendanceEstimate: input.attendanceEstimate ?? null,
            minTier,
            owner: req.user!.id,
          });

          if (input.teamId) {
            await tx.insert(workstreams).values({ id: newId(), eventId, teamId: input.teamId });
          }

          // team_id NULL + a non-blank name are both CHECKs on an
          // event-kind channel; min_tier mirrors the event's.
          await tx
            .insert(channels)
            .values({ id: newId(), eventId, kind: "event", name: input.title, minTier });

          if (input.allocationCents) {
            await allocateToEvent(tx, eventId, input.allocationCents);
          }

          await audit(tx, req.user!.id, "event.created", eventId, { title: input.title });
        });
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          res.status(409).json({ error: { code: "BUDGET_EXCEEDED", message: error.message } });
          return;
        }
        throw error;
      }

      const event = await fetchEventDetail(eventId);
      res.status(201).json({ event: event! } satisfies EventResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── PATCH /api/events/:id ─────────────────────────────────────────────────────

eventsRouter.patch(
  "/events/:id",
  authenticate,
  authorise(0),
  validate(eventParamsSchema, "params"),
  validate(updateEventSchema),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const input = res.locals.validated as UpdateEvent;
      const db = getDb();

      const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
      if (!event) {
        notFound(res);
        return;
      }

      // Owner-or-tier is a per-resource rule: it needs the loaded row, which
      // middleware never has. authorise() cannot express it.
      if (req.user!.tier < 1 && event.owner !== req.user!.id) {
        res.status(403).json({
          error: { code: "FORBIDDEN", message: "Only the owner or lead+ can edit this event." },
        });
        return;
      }

      const mergedStartsAt = input.startsAt ?? event.startsAt;
      const mergedEndsAt = input.endsAt !== undefined ? input.endsAt : event.endsAt;
      try {
        assertEventDates({ startsAt: mergedStartsAt, endsAt: mergedEndsAt });
      } catch (error) {
        if (error instanceof ValidationError) return validationErrorResponse(res, error);
        throw error;
      }

      const datesTouched = input.startsAt !== undefined || input.endsAt !== undefined;
      const warnings: string[] = [];

      try {
        await db.transaction(async (tx) => {
          if (input.minTier !== undefined && input.minTier > event.minTier) {
            const assigneeTiers = await tx
              .select({ assigneeTier: appUsers.tier })
              .from(taskAssignees)
              .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
              .innerJoin(appUsers, eq(appUsers.id, taskAssignees.userId))
              .where(eq(tasks.eventId, id));
            assertNoTierEscalation(input.minTier, assigneeTiers);
          }

          if (
            input.allocationCents !== undefined &&
            input.allocationCents !== event.allocationCents
          ) {
            await allocateToEvent(tx, id, input.allocationCents);
          }

          const { allocationCents: _omitAlloc, ...columnPatch } = input;
          await tx
            .update(events)
            .set({ ...columnPatch, updatedAt: new Date() })
            .where(eq(events.id, id));

          if (datesTouched) {
            const boundary = mergedEndsAt ?? mergedStartsAt;
            const overhangResult = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(tasks)
              .where(and(eq(tasks.eventId, id), gt(tasks.dueAt, boundary)));
            const overhang = Number(overhangResult[0]?.count ?? 0);
            if (overhang > 0) {
              warnings.push(
                `${overhang} task${overhang === 1 ? "" : "s"} now fall${overhang === 1 ? "s" : ""} after the event date`,
              );
            }
            await notifyAssignees(tx, id, "event_date_changed", `"${event.title}" date changed.`);
          }

          await audit(tx, req.user!.id, "event.updated", id, input);
        });
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          res.status(409).json({ error: { code: "BUDGET_EXCEEDED", message: error.message } });
          return;
        }
        if (error instanceof ValidationError) return validationErrorResponse(res, error);
        throw error;
      }

      const updated = await fetchEventDetail(id);
      res.status(200).json({
        event: updated!,
        ...(warnings.length > 0 ? { warnings } : {}),
      } satisfies EventResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── PATCH /api/events/:id/status ─────────────────────────────────────────────

eventsRouter.patch(
  "/events/:id/status",
  authenticate,
  authorise(1),
  validate(eventParamsSchema, "params"),
  validate(changeEventStatusSchema),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const { status: target } = res.locals.validated as ChangeEventStatus;
      const db = getDb();

      if (target === "wrapped") {
        const blockers = await wrapBlockers(db, id);
        if (blockers.length > 0) {
          const [current] = await db
            .select({ status: events.status })
            .from(events)
            .where(eq(events.id, id))
            .limit(1);
          if (!current) {
            notFound(res);
            return;
          }
          res
            .status(409)
            .json({ id, status: current.status, blockers } satisfies ChangeEventStatusResponse);
          return;
        }
      }

      const fromStatuses = allowedFromStatuses(target);
      const result = await db.execute<{ id: string; status: EventStatus }>(sql`
        UPDATE "event" SET status = ${target}, updated_at = now()
        WHERE id = ${id} AND status IN (${sql.join(
          fromStatuses.map((s) => sql`${s}`),
          sql`, `,
        )})
        RETURNING id, status
      `);

      const updated = result.rows[0];
      if (updated) {
        await audit(db, req.user!.id, "event.status_changed", id, { to: target });
        res.status(200).json({
          id: updated.id,
          status: updated.status,
          blockers: [],
        } satisfies ChangeEventStatusResponse);
        return;
      }

      // Zero rows: either this is a harmless double-click (current already
      // equals target) or a genuinely illegal hop. Same guarded update,
      // different meaning — disambiguate by re-reading the current row.
      const [current] = await db
        .select({ status: events.status })
        .from(events)
        .where(eq(events.id, id))
        .limit(1);
      if (!current) {
        notFound(res);
        return;
      }
      if (current.status === target) {
        res
          .status(200)
          .json({ id, status: current.status, blockers: [] } satisfies ChangeEventStatusResponse);
        return;
      }
      res.status(409).json({
        error: {
          code: "INVALID_TRANSITION",
          message: `Cannot move an event from ${current.status} to ${target}.`,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ── DELETE /api/events/:id ────────────────────────────────────────────────────
//
// Cancelling is president OR the director who leads the Events team, for an
// event that team actually contributes to. The Events-team lead can be tier
// 1, so the router floor is authorise(1) rather than authorise(2) — the
// president-vs-everyone-else split is a handler-level check instead of the
// whole gate. "The Events team" is identified by team.name = 'Events', the
// same name-based portfolio convention team.ts uses for "Marketing Director"
// — there is no dedicated schema column for it, so renaming that team breaks
// this check silently.

eventsRouter.delete(
  "/events/:id",
  authenticate,
  authorise(1),
  validate(eventParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const id = req.params.id!;
      const db = getDb();

      const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
      if (!event) {
        notFound(res);
        return;
      }

      const isPresident = can(req.user!.role, "event:cancel");
      let isEventsTeamLead = false;
      if (!isPresident) {
        const [eventsTeam] = await db.select().from(teams).where(eq(teams.name, "Events")).limit(1);
        if (eventsTeam?.lead === req.user!.id) {
          const [workstream] = await db
            .select({ id: workstreams.id })
            .from(workstreams)
            .where(and(eq(workstreams.eventId, id), eq(workstreams.teamId, eventsTeam.id)))
            .limit(1);
          isEventsTeamLead = Boolean(workstream);
        }
      }

      if (!isPresident && !isEventsTeamLead) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Only the president or the Events-team lead can cancel this event.",
          },
        });
        return;
      }

      if (event.status === "cancelled") {
        res.status(204).end();
        return;
      }

      const blockers = await cancelBlockers(db, id);
      if (blockers.length > 0) {
        res
          .status(409)
          .json({ error: { code: "APPROVED_EXPENSES_PENDING", message: blockers[0]! } });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .update(events)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(events.id, id), ne(events.status, "cancelled")));
        await releaseAllocation(tx, id);
        await notifyAssignees(tx, id, "event_cancelled", `"${event.title}" was cancelled.`);
        await audit(tx, req.user!.id, "event.cancelled", id, { from: event.status });
      });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
