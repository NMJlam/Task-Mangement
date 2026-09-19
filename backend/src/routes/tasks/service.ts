import { inArray } from "drizzle-orm";
import { newId } from "../../db/id.js";
import { taskAssignees, workstreams } from "../../db/schema/index.js";
import type { Queryable } from "../events/service.js";

/**
 * The one rule tasks own: a task that names both an event and a team sits in
 * that team's workstream on the event. The composite FK
 * `task_within_declared_workstream` refuses the write otherwise, so the task
 * routes declare the workstream on first use rather than asking for a separate
 * call — pairing a team with an event through a task IS the declaration.
 *
 * Framework-free like `routes/events/service.ts`, so the pure half is
 * unit-tested with no database.
 */

/** Where a task sits. Either side may be null: standing or cross-team work. */
export interface TaskLink {
  eventId: string | null;
  teamId: string | null;
}

/**
 * The one place a `task` row becomes a wire `Task`. The junction is a second
 * table, so a bare `.select()` no longer satisfies `taskSchema` and a caller
 * that forgot this would return a task with no `assigneeIds` at all. Shared by
 * the task routes and the event routes that embed tasks.
 *
 * Reads links for the SELECTED task ids only — never the whole junction table:
 * a list page's 50 rows are a filter, not a starting point for a scan.
 *
 * `overdueEscalatedAt` is backend operational state with no place in the wire
 * shape, so it is dropped here — the one choke point every task read passes
 * through. The constraint declares it optional, so a full-row `.select()` and a
 * narrow projection (the calendar's) both satisfy it.
 */
export async function assembleTasks<T extends { id: string; overdueEscalatedAt?: Date | null }>(
  db: Queryable,
  rows: readonly T[],
): Promise<(Omit<T, "overdueEscalatedAt"> & { assigneeIds: string[] })[]> {
  if (rows.length === 0) return [];
  const links = await db
    .select()
    .from(taskAssignees)
    .where(
      inArray(
        taskAssignees.taskId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map(({ overdueEscalatedAt: _marker, ...row }) => ({
    ...row,
    assigneeIds: links.filter((link) => link.taskId === row.id).map((link) => link.userId),
  }));
}

export interface WorkstreamKey {
  eventId: string;
  teamId: string;
}

/**
 * The link a PATCH leaves behind. `undefined` keeps the stored side and `null`
 * clears it — collapsing the two would unlink a task every time a patch didn't
 * mention its event.
 */
export function mergeLink(
  stored: TaskLink,
  patch: { eventId?: string | null; teamId?: string | null },
): TaskLink {
  return {
    eventId: patch.eventId === undefined ? stored.eventId : patch.eventId,
    teamId: patch.teamId === undefined ? stored.teamId : patch.teamId,
  };
}

/** The distinct (event, team) pairs among `links` that need a workstream. */
export function workstreamKeys(
  links: readonly { eventId?: string | null; teamId?: string | null }[],
): WorkstreamKey[] {
  const keys = new Map<string, WorkstreamKey>();
  for (const { eventId, teamId } of links) {
    if (eventId && teamId) keys.set(`${eventId}|${teamId}`, { eventId, teamId });
  }
  return [...keys.values()];
}

/**
 * Inserts whichever workstreams are missing. `ON CONFLICT DO NOTHING` on the
 * one-per-team-per-event key makes this idempotent and safe under concurrent
 * requests for the same pair.
 *
 * Deliberately not in a transaction with the task write: production runs the
 * Neon HTTP driver, which has none. A task write that fails afterwards leaves a
 * workstream with no tasks — the same state `POST /api/events` with a `teamId`
 * creates, so nothing downstream reads it as an error.
 */
export async function ensureWorkstreams(
  db: Queryable,
  keys: readonly WorkstreamKey[],
): Promise<void> {
  if (keys.length === 0) return;
  await db
    .insert(workstreams)
    .values(keys.map((key) => ({ id: newId(), ...key })))
    .onConflictDoNothing({ target: [workstreams.eventId, workstreams.teamId] });
}
