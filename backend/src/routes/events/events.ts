import {
  calendarQuerySchema,
  eventCursorSchema,
  eventParamsSchema,
  getEventQuerySchema,
  listEventsQuerySchema,
  type CalendarItem,
  type CalendarQuery,
  type CalendarResponse,
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
} from "@ctp/shared";
import { and, asc, eq, exists, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { channels, events, tasks, workstreams } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import { computeProgress } from "./service.js";

export const eventsRouter = Router();

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
        detail.tasks = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.eventId, id), lte(tasks.minTier, req.user!.tier)))
          .orderBy(asc(tasks.boardOrder))
          .limit(50);
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
            assigneeId: tasks.assignee,
          })
          .from(tasks)
          .where(and(...filters))
          .orderBy(asc(tasks.dueAt));
        for (const row of rows) items.push({ kind: "task", ...row });
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
