import { insertAfter, type TaskStatus, type Tier } from "@ctp/shared";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { newId } from "../../db/id.js";
import { events, taskAssignees, tasks, workstreams } from "../../db/schema/index.js";
import type { Queryable, Tx } from "../events/service.js";

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

/**
 * The tasks a member at `tier` may see: the task's own `min_tier` is at or
 * below theirs, and so is its event's, if it has one. Every task route reads
 * through this, so a task on an event that `GET /api/events/:id` hides answers
 * 404 too — a task list is not a side door to the event's title or id.
 *
 * A cancelled event does NOT hide its tasks, matching the event routes, which
 * still serve a cancelled event by id: its open work still needs a home on the
 * board until someone closes or moves it.
 */
export function visibleTasks(tier: Tier): SQL {
  return and(
    lte(tasks.minTier, tier),
    or(
      isNull(tasks.eventId),
      sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${tasks.eventId} AND ${lte(events.minTier, tier)})`,
    ),
  )!;
}

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
 * The task routes call it inside the same transaction as the task write, so a
 * write that fails leaves no workstream behind.
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

/**
 * Renumbers the column `moved` now sits in, so `moved` lands immediately after
 * `afterId` (`null` = the top). The moved row's status must already be written:
 * the column is read at its new status, and the moved card's stored slot is
 * what `insertAfter` overrides.
 *
 * The column is every task of that status — events and the standing board
 * together, because that is the column a user sees. `/tasks` mixes every
 * event's cards in one column, so scoping the renumber to the moved card's own
 * event would leave a card that was dropped between two other events' cards
 * nowhere near where it was dropped on the next read. Order is the read order
 * the board and the list endpoint share: stored slot, then newest first, then
 * id, so two cards that have never been ranked come back in the order the list
 * endpoint shows them.
 *
 * Takes a transaction because the renumber and the status write it follows are
 * one user action: a half-renumbered column is a duplicated or missing slot.
 */
export async function reorderColumn(
  tx: Tx,
  moved: { id: string; status: TaskStatus },
  afterId: string | null,
): Promise<void> {
  const column = await tx
    .select({ id: tasks.id, boardOrder: tasks.boardOrder })
    .from(tasks)
    .where(eq(tasks.status, moved.status))
    .orderBy(asc(tasks.boardOrder), desc(tasks.createdAt), asc(tasks.id));

  const ids = insertAfter(
    column.map((row) => row.id),
    moved.id,
    afterId,
  );

  const stored = new Map(column.map((row) => [row.id, row.boardOrder]));

  // ponytail: one UPDATE per card in the column, inside the caller's
  // transaction, which is fine to about a hundred cards — past that, the
  // unnest-shaped single statement is the upgrade. Two moves in one column at
  // the same instant are last-write-wins, which is why no row lock is taken at
  // club scale; the next read renumbers.
  for (const [boardOrder, id] of ids.entries()) {
    if (stored.get(id) === boardOrder) continue;
    // `updated_at` is deliberately left alone: only the moved row is a
    // user-visible edit, and the cards that merely shifted are not.
    await tx.update(tasks).set({ boardOrder }).where(eq(tasks.id, id));
  }
}
