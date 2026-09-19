import {
  eventStatusTransitions,
  type ChangeableEventStatus,
  type EventProgress,
  type EventStatus,
  type Risk,
  type TaskCounts,
  type Tier,
} from "@ctp/shared";
import { and, lte, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { CLUB_TIMEZONE } from "../../config/club.js";
import { events } from "../../db/schema/index.js";
import type * as schema from "../../db/schema/index.js";

/**
 * The transaction handle every function below takes. Derived from
 * `getDb().transaction()`'s own callback parameter rather than hand-typed, so
 * it can never drift from what `db.transaction()` actually hands the callback.
 */
export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Either an open transaction or the plain top-level db handle. Money-rule
 * functions (`allocateToEvent`, `releaseAllocation`) always need the former —
 * they must run inside the same transaction as the write they guard — but the
 * read-only blocker checks are single statements with nothing to roll back,
 * so callers may pass either.
 */
export type Queryable = Tx | NodePgDatabase<typeof schema>;

/**
 * Renders the same `VALIDATION_ERROR` 422 body the `validate()` middleware
 * produces (`shared/apiErrorSchema`), so a route-level `catch` can turn either
 * one into an identical response regardless of which layer rejected the
 * request. The route handler (Phase 4/5) is responsible for the actual
 * `res.status(422).json(...)` — this class only carries the field messages.
 */
export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string[]>) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}

/** 409 — allocating would push the club-wide total past `settings.budget_cents`. */
export class BudgetExceededError extends Error {
  constructor(message = "Allocating this event would exceed the club budget.") {
    super(message);
    this.name = "BudgetExceededError";
  }
}

// ── Rule 1 / Rule 2 — the budget pool ────────────────────────────────────────

/**
 * Rule 1: total event allocation must never exceed `settings.budget_cents`.
 * `SELECT ... FOR UPDATE` on the singleton settings row is the whole point —
 * without it, two concurrent allocations both read the same "current total"
 * and both pass, and the club overspends. Everything between that lock and
 * the `UPDATE` below runs serialised against any other allocation in flight.
 *
 * Assumes the event row already exists with `allocation_cents` at its old
 * value (0 for a fresh `POST`) — this only performs the write, guarded by the
 * check.
 */
export async function allocateToEvent(tx: Tx, eventId: string, cents: number): Promise<void> {
  const budgetResult = await tx.execute<{ budget_cents: number }>(
    sql`SELECT budget_cents FROM "settings" WHERE id = 1 FOR UPDATE`,
  );
  const budgetCents = Number(budgetResult.rows[0]?.budget_cents ?? 0);

  const totalResult = await tx.execute<{ total: number }>(sql`
    SELECT COALESCE(SUM(allocation_cents), 0) AS total
    FROM "event"
    WHERE status <> 'cancelled' AND id <> ${eventId}
  `);
  const existingTotal = Number(totalResult.rows[0]?.total ?? 0);

  if (existingTotal + cents > budgetCents) {
    throw new BudgetExceededError();
  }

  await tx.execute(sql`UPDATE "event" SET allocation_cents = ${cents} WHERE id = ${eventId}`);
}

/**
 * Rule 2: cancelling an event releases its unspent allocation — down to the
 * spend already committed (`approved` + `paid`), never to zero. Money already
 * out the door stays allocated; only the unspent slice goes back to the pool.
 */
export async function releaseAllocation(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE "event"
    SET allocation_cents = COALESCE(
      (SELECT SUM(amount_cents) FROM "expense"
       WHERE event_id = ${eventId} AND status IN ('approved', 'paid')),
      0
    )
    WHERE id = ${eventId}
  `);
}

/** Pending-expense blockers for the `PATCH /:id/status` wrap guard (409). */
export async function wrapBlockers(tx: Queryable, eventId: string): Promise<string[]> {
  const result = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM "expense"
    WHERE event_id = ${eventId} AND status = 'pending'
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  return count > 0
    ? [`${count} pending expense${count === 1 ? "" : "s"} must be resolved before wrapping`]
    : [];
}

/**
 * Approved-but-unpaid-expense blockers for `DELETE /:id` (cancel). Distinct
 * from `wrapBlockers`: an approved expense here means someone still needs to
 * pay it or reject it — cancelling out from under that decision is the thing
 * being refused, not the pending-expense case wrapping guards against.
 */
export async function cancelBlockers(tx: Queryable, eventId: string): Promise<string[]> {
  const result = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM "expense"
    WHERE event_id = ${eventId} AND status = 'approved'
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  return count > 0
    ? [
        `${count} approved expense${count === 1 ? "" : "s"} must be paid or rejected before cancelling`,
      ]
    : [];
}

// ── Status transitions ───────────────────────────────────────────────────────

/**
 * The current statuses a guarded update to `target` is allowed to move from —
 * the INVERSE of `eventStatusTransitions` in `@ctp/shared`, which is the one
 * definition of the lifecycle both sides read (the event page renders a control
 * from its forward edges). Inverting it here rather than keeping a second table
 * is what stops a button appearing for a hop this route would refuse.
 */
// The record is exhaustive, so its own keys ARE the status vocabulary.
const ALL_STATUSES = Object.keys(eventStatusTransitions) as EventStatus[];

export function allowedFromStatuses(target: ChangeableEventStatus): readonly string[] {
  return ALL_STATUSES.filter((from) => eventStatusTransitions[from].includes(target));
}

// ── Cross-field validation ────────────────────────────────────────────────────

/**
 * `endsAt >= startsAt`, checked against the MERGED row — never a schema
 * `.refine` on the request body alone. `PATCH { startsAt }` on an event whose
 * stored `endsAt` is earlier would pass a body-only refine (the body has no
 * `endsAt` to compare against) and hit the `event_ends_after_start_check` CHECK
 * as a 500. Calling this with `{ ...event, ...input }` on both `POST` and
 * `PATCH` gives the rule exactly one definition and turns that 500 into a 422
 * with a field message.
 */
export function assertEventDates(merged: { startsAt: Date; endsAt: Date | null }): void {
  if (merged.endsAt && merged.endsAt < merged.startsAt) {
    throw new ValidationError({ endsAt: ["endsAt must not precede startsAt"] });
  }
}

/**
 * Rule 5 combined with Rule 3: raising an event's `min_tier` on `PATCH` must
 * not hide a child task from its own assignee. The task's own `min_tier` is
 * unchanged by this — but `GET /events` already 404s a tier miss, so an
 * assignee below the new `min_tier` loses the event (and everything under it)
 * the moment this write lands.
 */
export function assertNoTierEscalation(
  newMinTier: Tier,
  tasks: readonly { assigneeTier: Tier | null }[],
): void {
  const hidden = tasks.some((task) => task.assigneeTier !== null && task.assigneeTier < newMinTier);
  if (hidden) {
    throw new ValidationError({
      minTier: ["Raising minTier would hide a task from its own assignee"],
    });
  }
}

// ── Visibility ─────────────────────────────────────────────────────────────

/**
 * `min_tier <= tier AND status <> 'cancelled'`, in one place so no read
 * forgets it. A tier miss is a 404 at the route, never a 403 — a 403 would
 * confirm the event exists.
 */
export function visibleEvents(userTier: Tier) {
  return and(lte(events.minTier, userTier), ne(events.status, "cancelled"));
}

// ── Progress / risk ────────────────────────────────────────────────────────

/** `YYYY-MM-DD` in `timeZone` — the calendar day a timestamp falls on there. */
function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Whole calendar days between two instants IN THE CLUB TIMEZONE — a UTC diff
 * is off by one for an evening event whenever the club's local date has
 * already rolled over past midnight UTC.
 */
function daysBetween(from: Date, to: Date, timeZone: string): number {
  const utcMidnight = (date: Date): number => {
    const [year, month, day] = localDateKey(date, timeZone).split("-").map(Number) as [
      number,
      number,
      number,
    ];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
}

/**
 * Fraction of the planning runway (`createdAt` -> `startsAt`) already used.
 * Not in the endpoint doc's formula by name, but `budgetBurn > elapsedFraction
 * + 0.2` needs *some* notion of "how far through planning are we", and the
 * event's own lifespan is the only clock available without inventing a new
 * column. Clamped to [0, 1]; an event starting at or before its own creation
 * (the zero-length-runway edge case) reads as fully elapsed.
 */
function elapsedFraction(createdAt: Date, startsAt: Date, now: Date): number {
  const total = startsAt.getTime() - createdAt.getTime();
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - createdAt.getTime()) / total));
}

export interface ComputeProgressInput {
  startsAt: Date;
  createdAt: Date;
  allocationCents: number;
  committedCents: number;
  taskCounts: TaskCounts;
  overdueCount: number;
  /** Injected for tests; defaults to the real clock. */
  now?: Date;
}

/**
 * The one place the risk rule is written down, so the dashboard, the digest
 * email and the report all agree. `blocked` counts toward the denominator of
 * `percentComplete`, never the numerator — it is not done.
 */
export function computeProgress(input: ComputeProgressInput): EventProgress {
  const now = input.now ?? new Date();
  const { todo, inProgress, blocked, done } = input.taskCounts;
  const total = todo + inProgress + blocked + done;
  const percentComplete = total === 0 ? 0 : Math.round((done / total) * 100);

  const budgetBurn =
    input.allocationCents === 0 ? null : input.committedCents / input.allocationCents;

  const daysUntil = daysBetween(now, input.startsAt, CLUB_TIMEZONE);
  const elapsed = elapsedFraction(input.createdAt, input.startsAt, now);
  const overBudget = budgetBurn !== null && budgetBurn > 1;
  const burningFast = budgetBurn !== null && budgetBurn > elapsed + 0.2;

  let risk: Risk = "on_track";
  if ((input.overdueCount > 0 && daysUntil <= 3) || overBudget) {
    risk = "critical";
  } else if (input.overdueCount > 0 || burningFast) {
    risk = "at_risk";
  }

  const riskReasons: string[] = [];
  if (input.overdueCount > 0) {
    riskReasons.push(`${input.overdueCount} overdue task${input.overdueCount === 1 ? "" : "s"}`);
  }
  if (overBudget) {
    riskReasons.push("Budget allocation exceeded");
  } else if (burningFast) {
    riskReasons.push("Spend is ahead of schedule");
  }

  return {
    percentComplete,
    overdueCount: input.overdueCount,
    daysUntil,
    budgetBurn,
    risk,
    riskReasons,
  };
}
