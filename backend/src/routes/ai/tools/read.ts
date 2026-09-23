import {
  eventStatusSchema,
  taskPrioritySchema,
  taskStatusSchema,
  type TaskStatus,
  type Tier,
} from "@ctp/shared";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  appUsers,
  channels,
  events,
  expenses,
  messages,
  taskAssignees,
  tasks,
} from "../../../db/schema/index.js";
import { getBudgetSummary } from "../../budget/service.js";
import { computeProgress, visibleEvents, type Queryable } from "../../events/service.js";
import { assertCanReadChannel, type Viewer } from "../../threads/service.js";
import type { Tool, ToolContext } from "./registry.js";

/**
 * The planning corpus size. `event` has a `status` and no type or category
 * column, so recency is the ordering available — if a type column is added
 * later, narrowing the corpus by it is a change to this file alone.
 */
export const PLAN_CORPUS_EVENTS = 5;

/** Nothing the assistant reads is unbounded; a free-tier prompt has to fit. */
const READ_LIMIT = 50;

// ── Shared predicates ─────────────────────────────────────────────────────
//
// Every read below that can surface a task or an event goes through these,
// so no read forgets the ONE property this feature rests on: the assistant
// inherits the caller's permissions and cannot exceed them.

/**
 * A task's own event, if it has one, must be visible — the same rule
 * `visibleThreads` (`routes/threads/service.ts`) applies to an event
 * thread, applied here so a task tied to a tier-gated or cancelled event
 * cannot surface through the assistant either, even though the task row
 * itself carries no tier of its own. A standing task (no event) always
 * passes. Mirrors the `EXISTS` shape `visibleThreads` already uses rather
 * than a join, so callers need not pull `events` into their own `.from()`.
 */
function taskEventVisible(tier: Tier): SQL {
  return or(
    isNull(tasks.eventId),
    sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${tasks.eventId} AND ${visibleEvents(tier)})`,
  )!;
}

/** `EXISTS` a `task_assignee` row putting `userId` on the task being filtered.
 * Mirrors `routes/tasks/tasks.ts`'s own private `assignedTo` — duplicated
 * because that one is not exported, not because the rule differs. */
function assignedTo(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${taskAssignees} WHERE ${taskAssignees.taskId} = ${tasks.id} AND ${taskAssignees.userId} = ${userId})`;
}

// ── listTasks ────────────────────────────────────────────────────────────

export const listTasks: Tool = {
  name: "listTasks",
  minTier: 0,
  describe:
    "List club tasks. Args: status (todo|in_progress|blocked|done), priority, eventHandle, assigneeHandle. Returns each task with a handle you must use to refer to it.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const where: SQL[] = [taskEventVisible(ctx.tier as Tier)];
    const status =
      typeof args.status === "string" ? taskStatusSchema.safeParse(args.status) : undefined;
    if (status?.success) where.push(eq(tasks.status, status.data));
    const priority =
      typeof args.priority === "string" ? taskPrioritySchema.safeParse(args.priority) : undefined;
    if (priority?.success) where.push(eq(tasks.priority, priority.data));
    if (typeof args.eventHandle === "string") {
      where.push(eq(tasks.eventId, ctx.handles.resolve(args.eventHandle)));
    }
    if (typeof args.assigneeHandle === "string") {
      where.push(assignedTo(ctx.handles.resolve(args.assigneeHandle)));
    }

    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        eventId: tasks.eventId,
      })
      .from(tasks)
      .where(and(...where))
      .orderBy(desc(tasks.createdAt))
      .limit(READ_LIMIT);

    // The id never leaves this function. The model only ever sees the handle.
    return rows.map((row) => ({
      handle: ctx.handles.issue("T", row.id),
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt?.toISOString() ?? null,
      eventHandle: row.eventId ? ctx.handles.issue("E", row.eventId) : null,
    }));
  },
};

// ── listOverdueTasks ─────────────────────────────────────────────────────

export const listOverdueTasks: Tool = {
  name: "listOverdueTasks",
  minTier: 0,
  describe:
    "List overdue tasks: past their due date and not done. Args: priority, eventHandle, assigneeHandle. Returns each task with a handle you must use to refer to it.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    // Overdue is derived, never stored — the same predicate GET /api/tasks/overdue
    // uses (`routes/tasks/tasks.ts`): past due and not yet done.
    const where: SQL[] = [
      lt(tasks.dueAt, new Date()),
      ne(tasks.status, "done"),
      taskEventVisible(ctx.tier as Tier),
    ];
    const priority =
      typeof args.priority === "string" ? taskPrioritySchema.safeParse(args.priority) : undefined;
    if (priority?.success) where.push(eq(tasks.priority, priority.data));
    if (typeof args.eventHandle === "string") {
      where.push(eq(tasks.eventId, ctx.handles.resolve(args.eventHandle)));
    }
    if (typeof args.assigneeHandle === "string") {
      where.push(assignedTo(ctx.handles.resolve(args.assigneeHandle)));
    }

    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        eventId: tasks.eventId,
      })
      .from(tasks)
      .where(and(...where))
      .orderBy(asc(tasks.dueAt))
      .limit(READ_LIMIT);

    return rows.map((row) => ({
      handle: ctx.handles.issue("T", row.id),
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt?.toISOString() ?? null,
      eventHandle: row.eventId ? ctx.handles.issue("E", row.eventId) : null,
    }));
  },
};

// ── listEvents ───────────────────────────────────────────────────────────

export const listEvents: Tool = {
  name: "listEvents",
  minTier: 0,
  describe:
    "List club events (never cancelled ones). Args: status (planning|live|wrapped), from, to (ISO dates, filtering by start time). Returns each event with a handle you must use to refer to it.",
  async run(ctx: ToolContext, args): Promise<unknown> {
    const where: SQL[] = [visibleEvents(ctx.tier as Tier)!];
    const status =
      typeof args.status === "string" ? eventStatusSchema.safeParse(args.status) : undefined;
    if (status?.success) where.push(eq(events.status, status.data));
    if (typeof args.from === "string") {
      const from = new Date(args.from);
      if (!Number.isNaN(from.getTime())) where.push(gte(events.startsAt, from));
    }
    if (typeof args.to === "string") {
      const to = new Date(args.to);
      if (!Number.isNaN(to.getTime())) where.push(lte(events.startsAt, to));
    }

    const rows = await ctx.db
      .select({
        id: events.id,
        title: events.title,
        status: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        venue: events.venue,
      })
      .from(events)
      .where(and(...where))
      .orderBy(asc(events.startsAt))
      .limit(READ_LIMIT);

    return rows.map((row) => ({
      handle: ctx.handles.issue("E", row.id),
      title: row.title,
      status: row.status,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      venue: row.venue,
    }));
  },
};

// ── getEventProgress ─────────────────────────────────────────────────────

export const getEventProgress: Tool = {
  name: "getEventProgress",
  minTier: 0,
  describe: "Task completion, budget burn and risk for one event. Args: eventHandle (required).",
  async run(ctx: ToolContext, args): Promise<unknown> {
    if (typeof args.eventHandle !== "string") return { error: "eventHandle is required" };
    const eventId = ctx.handles.resolve(args.eventHandle);

    const [event] = await ctx.db
      .select({
        startsAt: events.startsAt,
        createdAt: events.createdAt,
        allocationCents: events.allocationCents,
      })
      .from(events)
      .where(and(eq(events.id, eventId), visibleEvents(ctx.tier as Tier)))
      .limit(1);
    // A handle only ever comes from a read tool that already gated on
    // visibleEvents at issue time, so this is a defensive re-check, not the
    // primary gate — see the module comment on `taskEventVisible`.
    if (!event) return { error: "No event with that handle." };

    const [taskCounts] = await ctx.db
      .select({
        todo: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'todo')`.mapWith(Number),
        inProgress: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'in_progress')`.mapWith(
          Number,
        ),
        blocked: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'blocked')`.mapWith(Number),
        done: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done')`.mapWith(Number),
        overdueCount:
          sql<number>`count(*) FILTER (WHERE ${tasks.status} <> 'done' AND ${tasks.dueAt} < now())`.mapWith(
            Number,
          ),
      })
      .from(tasks)
      .where(eq(tasks.eventId, eventId));

    const [expenseTotals] = await ctx.db
      .select({
        committedCents:
          sql<number>`COALESCE(SUM(${expenses.amountCents}) FILTER (WHERE ${expenses.status} IN ('approved', 'paid')), 0)`.mapWith(
            Number,
          ),
      })
      .from(expenses)
      .where(eq(expenses.eventId, eventId));

    return computeProgress({
      startsAt: event.startsAt,
      createdAt: event.createdAt,
      allocationCents: event.allocationCents,
      committedCents: expenseTotals?.committedCents ?? 0,
      taskCounts: {
        todo: taskCounts?.todo ?? 0,
        inProgress: taskCounts?.inProgress ?? 0,
        blocked: taskCounts?.blocked ?? 0,
        done: taskCounts?.done ?? 0,
      },
      overdueCount: taskCounts?.overdueCount ?? 0,
    });
  },
};

// ── listMembers ──────────────────────────────────────────────────────────

/**
 * Identity comes from `auth.user` in raw SQL, same reasoning as
 * `routes/members/members.ts`'s `readIdentities`: `app_user` deliberately
 * stores neither name nor email, and adding them to the read-only `authUser`
 * Drizzle declaration would make `db:generate` try to ALTER a table Better
 * Auth already owns. Not imported from `members.ts` because that function is
 * private to the route.
 */
async function memberNames(db: Queryable): Promise<Map<string, string>> {
  const result = await db.execute<{ id: string; name: string }>(
    sql`SELECT "id", "name" FROM auth."user"`,
  );
  return new Map(result.rows.map((row) => [row.id, row.name]));
}

/**
 * Committee load, which is what Smart-assign runs on. The open-task count per
 * member is the same figure the dashboard's Committee Load widget shows, so the
 * assistant and the dashboard cannot disagree about who is busy: every holder of
 * a not-done task counts, multi-assignee included, exactly as
 * `frontend/src/routes/dashboard.tsx`'s own reducer does it client-side. A pure
 * function so this NEW server-side rule is unit-testable without a database.
 */
export function countOpenTasksByAssignee(
  rows: readonly { userId: string; status: TaskStatus }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "done") counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
  }
  return counts;
}

export const listMembers: Tool = {
  name: "listMembers",
  minTier: 0,
  describe:
    "List club members with role, tier and current open-task count. Returns each with a handle you must use to refer to them, e.g. to assign work.",
  async run(ctx: ToolContext): Promise<unknown> {
    const [roster, names, assignments] = await Promise.all([
      ctx.db
        .select({
          id: appUsers.id,
          role: appUsers.role,
          tier: appUsers.tier,
          authUserId: appUsers.authUserId,
        })
        .from(appUsers),
      memberNames(ctx.db),
      ctx.db
        .select({ userId: taskAssignees.userId, status: tasks.status })
        .from(taskAssignees)
        .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId)),
    ]);

    const openCounts = countOpenTasksByAssignee(assignments);
    return roster.map((member) => ({
      handle: ctx.handles.issue("M", member.id),
      name: names.get(member.authUserId) ?? "",
      role: member.role,
      tier: member.tier,
      openTaskCount: openCounts.get(member.id) ?? 0,
    }));
  },
};

// ── pastEventPlans ───────────────────────────────────────────────────────

export const pastEventPlans: Tool = {
  name: "pastEventPlans",
  minTier: 0,
  describe: `The ${PLAN_CORPUS_EVENTS} most recent past events and their tasks, as a planning reference for drafting a new event.`,
  async run(ctx: ToolContext): Promise<unknown> {
    const pastEvents = await ctx.db
      .select({ id: events.id, title: events.title, startsAt: events.startsAt })
      .from(events)
      .where(and(visibleEvents(ctx.tier as Tier), lt(events.startsAt, new Date())))
      .orderBy(desc(events.startsAt))
      .limit(PLAN_CORPUS_EVENTS);
    if (pastEvents.length === 0) return [];

    const eventIds = pastEvents.map((event) => event.id);
    const taskRows = await ctx.db
      .select({
        id: tasks.id,
        eventId: tasks.eventId,
        title: tasks.title,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(inArray(tasks.eventId, eventIds));

    return pastEvents.map((event) => ({
      handle: ctx.handles.issue("E", event.id),
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      tasks: taskRows
        .filter((task) => task.eventId === event.id)
        .map((task) => ({
          handle: ctx.handles.issue("T", task.id),
          title: task.title,
          priority: task.priority,
        })),
    }));
  },
};

// ── readThread ───────────────────────────────────────────────────────────

export const readThread: Tool = {
  name: "readThread",
  minTier: 0,
  describe:
    "Read the most recent messages in an event's discussion thread, oldest first. Args: eventHandle (required).",
  async run(ctx: ToolContext, args): Promise<unknown> {
    if (typeof args.eventHandle !== "string") return { error: "eventHandle is required" };
    const eventId = ctx.handles.resolve(args.eventHandle);
    const viewer: Viewer = { id: ctx.userId, tier: ctx.tier as Tier };

    // Events open with exactly one channel of kind 'event' (POST /api/events);
    // finding its id is not itself a visibility check — assertCanReadChannel,
    // below, is the actual gate.
    const [channel] = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.kind, "event"), eq(channels.eventId, eventId)))
      .limit(1);
    if (!channel) return { error: "This event has no discussion thread." };

    // Throws ChannelForbiddenError, uncaught here by design: a member asking
    // the assistant to read a channel they cannot open is a real permission
    // failure, not a "this tool isn't for you" refusal — so it propagates to
    // the route the same way it would from the threads route itself.
    await assertCanReadChannel(ctx.db, viewer, channel.id);

    const rows = await ctx.db
      .select({ author: messages.author, body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.channelId, channel.id))
      .orderBy(desc(messages.createdAt))
      .limit(READ_LIMIT);

    return rows
      .slice()
      .reverse()
      .map((row) => ({
        author: row.author ? ctx.handles.issue("M", row.author) : null,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      }));
  },
};

// ── readBudget ───────────────────────────────────────────────────────────

/** Read only (Rule 13) — there is no matching write tool, and none of money,
 * deletion, event cancellation, role changes or invites has a tool at all. */
export const readBudget: Tool = {
  name: "readBudget",
  minTier: 0,
  describe:
    "The club's overall budget: allocated, committed, spent and available, per event and by expense category.",
  async run(ctx: ToolContext): Promise<unknown> {
    const summary = await getBudgetSummary(ctx.db);
    return {
      budgetCents: summary.budgetCents,
      allocationCents: summary.allocationCents,
      committedCents: summary.committedCents,
      spentCents: summary.spentCents,
      availableCents: summary.availableCents,
      risk: summary.risk,
      allocations: summary.allocations.map(({ eventId, ...allocation }) => ({
        ...allocation,
        eventHandle: ctx.handles.issue("E", eventId),
      })),
      byCategory: summary.byCategory,
    };
  },
};

export const READ_TOOLS: Tool[] = [
  listTasks,
  listOverdueTasks,
  listEvents,
  getEventProgress,
  listMembers,
  pastEventPlans,
  readThread,
  readBudget,
];
