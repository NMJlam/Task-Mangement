import { z } from "zod";
import { tierSchema } from "../role/role.js";
import { taskSchema } from "../task/task.js";

/**
 * Event lifecycle. `cancelled` IS the soft delete — there is no `deleted_at`,
 * because RESTRICT on `expense.event_id` already makes a destructive delete
 * impossible, and a soft-delete flag that leaks from one query is worse than a
 * hard delete.
 */
export const eventStatusSchema = z.enum(["planning", "live", "wrapped", "cancelled"]);

export type EventStatus = z.infer<typeof eventStatusSchema>;

/** Route params for every /events/:id endpoint. */
export const eventParamsSchema = z.object({ id: z.uuid() });

const titleSchema = z.string().trim().min(1, "Title is required").max(200);

// ── POST /api/events ─────────────────────────────────────────────────────────

/**
 * Shape only — `endsAt >= startsAt` is NOT a `.refine` here. A `PATCH` cannot
 * validate that rule against its own (possibly single-field) body, so both
 * verbs share one definition instead: `assertEventDates(merged)` in the
 * service layer (Phase 2). Duplicating a body-only refine here would just be a
 * second, weaker copy of the same rule.
 *
 * `teamId` seeds the event's first `workstream` row; it is not a column on
 * `event`, so `updateEventSchema` omits it below.
 */
export const createEventSchema = z.object({
  title: titleSchema,
  description: z.string().trim().max(2000).nullish(),
  venue: z.string().trim().max(200).nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  attendanceEstimate: z.number().int().nonnegative().nullish(),
  allocationCents: z.number().int().nonnegative().optional(),
  minTier: tierSchema.optional(),
  teamId: z.uuid().optional(),
});

export type CreateEvent = z.infer<typeof createEventSchema>;

// ── PATCH /api/events/:id ────────────────────────────────────────────────────

/**
 * Every field optional except `teamId` (dropped entirely — rewriting
 * workstreams is a different endpoint) and `status` (its own endpoint below).
 * At least one field required: `.partial()` alone would accept `{}` and
 * answer 200 to a no-op UPDATE.
 */
export const updateEventSchema = createEventSchema
  .omit({ teamId: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateEvent = z.infer<typeof updateEventSchema>;

// ── PATCH /api/events/:id/status ─────────────────────────────────────────────

/**
 * `cancelled` is deliberately excluded — it has exactly one door, `DELETE`,
 * because cancelling must also release the unspent allocation (Rule 2). A
 * second route into the same state is how that release gets skipped.
 */
export const changeEventStatusSchema = z.object({
  status: z.enum(["planning", "live", "wrapped"]),
});

export type ChangeEventStatus = z.infer<typeof changeEventStatusSchema>;

/** The statuses `PATCH /:id/status` can move an event TO — never `cancelled`. */
export type ChangeableEventStatus = ChangeEventStatus["status"];

export const changeEventStatusResponseSchema = z.object({
  id: z.uuid(),
  status: eventStatusSchema,
  blockers: z.array(z.string()),
});

export type ChangeEventStatusResponse = z.infer<typeof changeEventStatusResponseSchema>;

/**
 * The lifecycle's legal moves, `from → to`. Defined here because BOTH sides need
 * it and neither direction can be derived safely on one side alone: the route
 * enforces the transition with a guarded `UPDATE` (so it needs the allowed
 * SOURCES of a target) and the event page renders a control (so it needs the
 * allowed TARGETS of a source). A second copy in the UI is how a button appears
 * for a hop the route will refuse.
 *
 * `cancelled` is a target nowhere here: `DELETE` is its only door, because
 * cancelling must also release the unspent allocation. Its sole outgoing edge is
 * the restore path, which the UI does not expose (the cancel confirmation tells
 * the reader cancellation cannot be undone).
 */
export const eventStatusTransitions: Record<EventStatus, readonly ChangeableEventStatus[]> = {
  planning: ["live"],
  live: ["wrapped"],
  wrapped: ["live"],
  cancelled: ["planning"],
};

// ── GET /api/events ───────────────────────────────────────────────────────────

export const listEventsQuerySchema = z.object({
  teamId: z.uuid().optional(),
  status: eventStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ownerId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  // Direction is part of the keyset, not a client-side re-sort: a
  // cursor-paginated page sorted by the reader would reorder only the rows it
  // happens to hold, so "soonest first" would be a lie past the first page.
  // A cursor is direction-specific — it is issued with the order it was read
  // under, and replaying it against the other direction silently skips rows.
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

/** The decoded payload of the base64 `cursor` above. `starts_at` is not
 * unique, so the keyset is the composite `(startsAt, id)` — a
 * `startsAt`-only cursor drops or repeats rows whenever two events share a
 * start time. */
export const eventCursorSchema = z.object({
  startsAt: z.coerce.date(),
  id: z.uuid(),
});

export type EventCursor = z.infer<typeof eventCursorSchema>;

// ── GET /api/events/:id ───────────────────────────────────────────────────────

const includeValues = ["tasks", "expenses", "channel"] as const;

/** Comma-string preprocess: `?include=tasks,channel` becomes `["tasks",
 * "channel"]`. An unknown member 422s rather than being silently dropped. */
export const includeSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  },
  z.array(z.enum(includeValues)),
);

export const getEventQuerySchema = z.object({
  include: includeSchema.optional(),
});

export type GetEventQuery = z.infer<typeof getEventQuerySchema>;

// ── Response shapes ───────────────────────────────────────────────────────────

/**
 * Splits committed from spent so burn rate (`committedCents /
 * allocationCents`) is unambiguous: `spentCents` is `paid` expenses only,
 * `committedCents` is `approved` + `paid`. One schema referenced by both the
 * request (`allocationCents` on create/update) and every response, so a name
 * drift (`allocatedCents` vs `allocationCents`) is a type error, not a
 * runtime `undefined`.
 */
export const eventBudgetSchema = z.object({
  allocationCents: z.number().int().nonnegative(),
  committedCents: z.number().int().nonnegative(),
  spentCents: z.number().int().nonnegative(),
});

export type EventBudget = z.infer<typeof eventBudgetSchema>;

const eventOwnerSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
  })
  .nullable();

/**
 * Exactly four keys — `blocked` is a first-class status, and a three-key
 * response silently drops stalled work. `overdueCount` is NOT a fifth key
 * here: it overlaps `todo`/`inProgress`/`blocked` (an overdue task is also
 * one of those), so it ships as a sibling on the summary/detail schemas
 * instead, keeping `todo + inProgress + blocked + done` an honest total.
 */
export const taskCountsSchema = z.object({
  todo: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
});

export type TaskCounts = z.infer<typeof taskCountsSchema>;

export const eventSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: eventStatusSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable(),
  venue: z.string().nullable(),
  minTier: tierSchema,
  owner: eventOwnerSchema,
  taskCounts: taskCountsSchema,
  overdueCount: z.number().int().nonnegative(),
  budget: eventBudgetSchema,
});

export type EventSummary = z.infer<typeof eventSummarySchema>;

export const listEventsResponseSchema = z.object({
  items: z.array(eventSummarySchema),
  nextCursor: z.string().nullable(),
});

export type ListEventsResponse = z.infer<typeof listEventsResponseSchema>;

/**
 * `tasks` / `expenses` are declared here as TODO(R9): the expense row shape
 * (`GET /expenses`) does not exist yet, so embedding it now would create the
 * second bespoke shape the endpoint doc forbids. `tasks` reuses the real
 * `taskSchema` — `GET /tasks` landed on `main` and merged in, so this no
 * longer needs to wait. `channelId` and `unreadCount` are also TODO(R9):
 * `unreadCount` awaits the `chan_member` read-state decision (plan watch-out
 * 6) and is omitted rather than hardcoded to 0.
 */
export const eventDetailSchema = eventSummarySchema.extend({
  description: z.string().nullable(),
  attendanceEstimate: z.number().int().nonnegative().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  tasks: z.array(taskSchema).max(50).optional(),
  // TODO(R9): expenses embed — needs a shared `expenseSchema` first.
  channelId: z.uuid().optional(),
});

export type EventDetail = z.infer<typeof eventDetailSchema>;

/**
 * `warnings` is populated only by `PATCH /api/events/:id` when a date move
 * leaves task due dates on the wrong side of the event — the route never
 * moves them itself, it surfaces the count and lets the user decide. Absent
 * (not empty) on every other response, including a no-op-free `GET`.
 */
export const eventResponseSchema = z.object({
  event: eventDetailSchema,
  warnings: z.array(z.string()).optional(),
});
export type EventResponse = z.infer<typeof eventResponseSchema>;

// ── GET /api/events/:id/progress ─────────────────────────────────────────────

export const riskSchema = z.enum(["on_track", "at_risk", "critical"]);
export type Risk = z.infer<typeof riskSchema>;

export const eventProgressSchema = z.object({
  percentComplete: z.number().int().min(0).max(100),
  overdueCount: z.number().int().nonnegative(),
  daysUntil: z.number().int(),
  budgetBurn: z.number().nullable(),
  risk: riskSchema,
  riskReasons: z.array(z.string()),
});

export type EventProgress = z.infer<typeof eventProgressSchema>;
