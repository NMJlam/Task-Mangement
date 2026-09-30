import type {
  AiApplyOperation,
  AiApplyRequest,
  AiApplyResponse,
  EventStatus,
  Role,
  Tier,
} from "@ctp/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { newId } from "../../db/id.js";
import { aiRuns, appUsers, channels, events, taskAssignees, tasks } from "../../db/schema/index.js";
import {
  allowedFromStatuses,
  assertEventDates,
  auditEvent,
  notifyAssignees,
  visibleEvents,
  wrapBlockers,
  type Tx,
} from "../events/service.js";
import { recordRunOutcome } from "./service.js";

/**
 * Any refusal inside the batch. Thrown, never returned, so the transaction
 * around it rolls back: the board after a confirmation is the plan that was on
 * screen, or nothing changes at all.
 */
export class ApplyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApplyError";
  }
}

const isTaskCreate = (operation: AiApplyOperation) =>
  operation.op === "create" && operation.entity === "task";

/**
 * The one gate an operation clears, given whether it is part of a bulk task
 * create. PATCH /api/events/:id is "owner, or tier 1" — its tier half is 0
 * here and `applyProposal` checks the owner half against the row. A status
 * change is PATCH /api/events/:id/status, tier 1.
 */
function tierFor(operation: AiApplyOperation, bulk: boolean): number {
  if (operation.op === "create") {
    return operation.entity === "event" || bulk ? 1 : 0;
  }
  if (operation.entity === "event") return operation.data.status === undefined ? 0 : 1;
  return 0;
}

/**
 * The permission mirror. Each operation is gated by the same check its
 * equivalent route uses, so "what the assistant can do" needs no second
 * document: it is what the member can do by hand. The single/bulk asymmetry is
 * deliberate — POST /api/tasks is tier 0 and POST /api/tasks/bulk is tier 1.
 *
 * Returns required tier → how many operations need it.
 */
export function requiredTierFor(operations: AiApplyOperation[]): Map<number, number> {
  const bulk = operations.filter(isTaskCreate).length > 1;
  const required = new Map<number, number>();
  for (const operation of operations) {
    const tier = tierFor(operation, bulk);
    required.set(tier, (required.get(tier) ?? 0) + 1);
  }
  return required;
}

/**
 * A staged event is created before the tasks that name its ref, so the ref has
 * a real id to become by the time a task needs it. Stable otherwise: nothing
 * else depends on order, so nothing else moves.
 */
export function orderOperations(operations: AiApplyOperation[]): AiApplyOperation[] {
  const isEventCreate = (operation: AiApplyOperation) =>
    operation.op === "create" && operation.entity === "event";
  return [
    ...operations.filter(isEventCreate),
    ...operations.filter((operation) => !isEventCreate(operation)),
  ];
}

/** What a refused operation was trying to do, in the words the member reads. */
function describe(operation: AiApplyOperation, bulk: boolean): string {
  if (operation.op === "create") {
    if (operation.entity === "event") return "create an event";
    return bulk ? "create more than one task at once" : "create a task";
  }
  if (operation.entity === "event") {
    return operation.data.status === undefined ? "edit this event" : "change an event's status";
  }
  return "edit a task";
}

/** The member-existence half of POST /api/tasks' reference check. */
async function assertMembersExist(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(inArray(appUsers.id, [...ids]));
  const missing = ids.find((id) => !found.some((row) => row.id === id));
  if (missing) throw new ApplyError(422, "ASSIGNEE_NOT_FOUND", `No member with id ${missing}.`);
}

/** Replaces a task's whole assignment set, as PATCH /api/tasks/:id does. */
async function setAssignees(tx: Tx, taskId: string, userIds: readonly string[]): Promise<void> {
  await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (userIds.length > 0) {
    await tx.insert(taskAssignees).values(userIds.map((userId) => ({ taskId, userId })));
  }
}

type CreateEventOperation = Extract<AiApplyOperation, { op: "create"; entity: "event" }>;
type CreateTaskOperation = Extract<AiApplyOperation, { op: "create"; entity: "task" }>;
type UpdateTaskOperation = Extract<AiApplyOperation, { op: "update"; entity: "task" }>;
type UpdateEventOperation = Extract<AiApplyOperation, { op: "update"; entity: "event" }>;
type Caller = { id: string; tier: number; role: Role };

/** POST /api/events, less the team and the money — neither is on a card. */
async function createEvent(tx: Tx, caller: Caller, runId: string, operation: CreateEventOperation) {
  const { data } = operation;
  assertEventDates({ startsAt: data.startsAt, endsAt: data.endsAt ?? null });
  const id = newId();
  const minTier = data.minTier ?? 0;
  await tx.insert(events).values({
    id,
    title: data.title,
    description: data.description ?? null,
    venue: data.venue ?? null,
    startsAt: data.startsAt,
    endsAt: data.endsAt ?? null,
    attendanceEstimate: data.attendanceEstimate ?? null,
    minTier,
    owner: caller.id,
    aiRunId: runId,
  });
  // The thread every event opens with, as POST /api/events does.
  await tx
    .insert(channels)
    .values({ id: newId(), eventId: id, kind: "event", name: data.title, minTier });
  await auditEvent(tx, caller.id, "event.created", id, { title: data.title, aiRunId: runId });
  return { id, title: data.title };
}

/** POST /api/tasks, with a staged event's ref already swapped for its id. */
async function createTask(
  tx: Tx,
  caller: Caller,
  runId: string,
  operation: CreateTaskOperation,
  refs: ReadonlyMap<string, string>,
) {
  const { data } = operation;
  let eventId = data.eventId;
  if (data.eventRef) {
    eventId = refs.get(data.eventRef);
    if (!eventId) {
      throw new ApplyError(422, "EVENT_NOT_FOUND", `No event was staged as ${data.eventRef}.`);
    }
  } else if (eventId) {
    // Above the caller's tier or cancelled reads as missing, as on POST /api/tasks.
    const [visible] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), visibleEvents(caller.tier as Tier)));
    if (!visible) throw new ApplyError(422, "EVENT_NOT_FOUND", `No event with id ${eventId}.`);
  }
  await assertMembersExist(tx, data.assigneeIds);
  const id = newId();
  await tx.insert(tasks).values({
    id,
    creator: caller.id,
    title: data.title,
    description: data.description ?? null,
    priority: data.priority,
    dueAt: data.dueAt ?? null,
    eventId: eventId ?? null,
    aiRunId: runId,
  });
  await setAssignees(tx, id, data.assigneeIds);
  return { id, title: data.title };
}

/** PATCH /api/tasks/:id. */
async function updateTask(tx: Tx, runId: string, operation: UpdateTaskOperation) {
  const { assigneeIds, ...columns } = operation.data;
  if (assigneeIds) await assertMembersExist(tx, assigneeIds);
  const [row] = await tx
    .update(tasks)
    .set({
      ...columns,
      // A moved deadline starts a new overdue cycle, as on PATCH /api/tasks/:id.
      ...(columns.dueAt !== undefined ? { overdueEscalatedAt: null } : {}),
      aiRunId: runId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, operation.id))
    .returning({ id: tasks.id, title: tasks.title });
  if (!row) throw new ApplyError(404, "TASK_NOT_FOUND", "Task not found.");
  if (assigneeIds) await setAssignees(tx, row.id, assigneeIds);
  return row;
}

/** PATCH /api/events/:id for the fields, then PATCH /api/events/:id/status for the status. */
async function updateEvent(tx: Tx, caller: Caller, runId: string, operation: UpdateEventOperation) {
  const { status, ...columns } = operation.data;
  const [event] = await tx.select().from(events).where(eq(events.id, operation.id));
  if (!event) throw new ApplyError(404, "EVENT_NOT_FOUND", "Event not found.");
  // Owner-or-tier needs the loaded row, as on PATCH /api/events/:id.
  if (caller.tier < 1 && event.owner !== caller.id) {
    throw new ApplyError(403, "FORBIDDEN", "Only the owner or lead+ can edit this event.");
  }

  if (Object.values(columns).some((value) => value !== undefined)) {
    const startsAt = columns.startsAt ?? event.startsAt;
    const endsAt = columns.endsAt !== undefined ? columns.endsAt : event.endsAt;
    assertEventDates({ startsAt, endsAt });
    await tx
      .update(events)
      .set({ ...columns, aiRunId: runId, updatedAt: new Date() })
      .where(eq(events.id, event.id));
    if (columns.startsAt !== undefined || columns.endsAt !== undefined) {
      await notifyAssignees(tx, event.id, "event_date_changed", `"${event.title}" date changed.`);
    }
    await auditEvent(tx, caller.id, "event.updated", event.id, { ...columns, aiRunId: runId });
  }

  if (status !== undefined && status !== event.status) {
    if (status === "wrapped") {
      const blockers = await wrapBlockers(tx, event.id);
      if (blockers.length > 0) throw new ApplyError(409, "WRAP_BLOCKED", blockers[0]!);
    }
    const moved = await tx.execute<{ id: string; status: EventStatus }>(sql`
      UPDATE "event" SET status = ${status}, ai_run_id = ${runId}, updated_at = now()
      WHERE id = ${event.id} AND status IN (${sql.join(
        allowedFromStatuses(status).map((from) => sql`${from}`),
        sql`, `,
      )})
      RETURNING id, status
    `);
    if (moved.rows.length === 0) {
      throw new ApplyError(
        409,
        "INVALID_TRANSITION",
        `Cannot move an event from ${event.status} to ${status}.`,
      );
    }
    await auditEvent(tx, caller.id, "event.status_changed", event.id, {
      to: status,
      aiRunId: runId,
    });
  }

  return { id: event.id, title: columns.title ?? event.title };
}

/**
 * Applies a confirmed card as the caller, inside the caller's transaction. Each
 * operation clears the gate its own route clears (`requiredTierFor`, plus the
 * event owner check), writes what that route writes, and is stamped with the
 * run it came from. A staged event's ref becomes its real id the moment it is
 * created, which `orderOperations` guarantees is before any task names it.
 */
export async function applyProposal(
  tx: Tx,
  caller: Caller,
  request: AiApplyRequest,
): Promise<AiApplyResponse> {
  // Only the member who ran the assistant scores and applies its card.
  const [run] = await tx
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(and(eq(aiRuns.id, request.runId), eq(aiRuns.userId, caller.id)));
  if (!run) throw new ApplyError(404, "RUN_NOT_FOUND", "That assistant run is not yours to apply.");

  const bulk = request.operations.filter(isTaskCreate).length > 1;
  const refused = request.operations.find((operation) => tierFor(operation, bulk) > caller.tier);
  if (refused) {
    throw new ApplyError(
      403,
      "FORBIDDEN",
      `Your role cannot ${describe(refused, bulk)}, so nothing was applied.`,
    );
  }

  const runId = request.runId;
  const refs = new Map<string, string>();
  const applied: AiApplyResponse = { events: [], tasks: [] };
  for (const operation of orderOperations(request.operations)) {
    if (operation.op === "create" && operation.entity === "event") {
      const event = await createEvent(tx, caller, runId, operation);
      refs.set(operation.ref, event.id);
      applied.events.push(event);
    } else if (operation.op === "create") {
      applied.tasks.push(await createTask(tx, caller, runId, operation, refs));
    } else if (operation.entity === "task") {
      applied.tasks.push(await updateTask(tx, runId, operation));
    } else {
      applied.events.push(await updateEvent(tx, caller, runId, operation));
    }
  }

  await recordRunOutcome(tx, runId, request.stats);
  return applied;
}
