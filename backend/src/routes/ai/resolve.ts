import {
  aiResolvedProposalSchema,
  type AiProposal,
  type AiResolvedProposal,
  type ResolvedFieldDiff,
} from "@ctp/shared";
import { eq, sql } from "drizzle-orm";
import { events, taskAssignees, tasks } from "../../db/schema/index.js";
import type { Queryable } from "../events/service.js";
import type { HandleMap } from "./handles.js";
import { AiOutputError } from "./service.js";

/** Minutes `timeZone` is ahead of UTC at `instant` (negative west of Greenwich). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute", number>;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The absolute deadline for a proposed task's `dueOffsetDays` (D14): 23:59 in
 * the club's timezone, on the event's LOCAL calendar day moved by the offset.
 * End of day because "due three days before" means that whole day — the same
 * default the task dialogs now give a deadline. The server owns this
 * arithmetic so the model never computes a calendar date, and the offset in
 * force is the one on the due day itself, so a daylight-saving change between
 * the two days cannot move the deadline by an hour.
 */
export function dueAtFromOffset(startsAt: Date, offsetDays: number, timeZone: string): Date {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(startsAt)
    .split("-")
    .map(Number) as [number, number, number];

  const wallClock = Date.UTC(year, month - 1, day + offsetDays, 23, 59);
  // Guess with the offset at the wall-clock time read as UTC, then correct once
  // with the offset at that guess — enough everywhere but inside a DST gap,
  // which 23:59 never falls in.
  const guess = wallClock - zoneOffsetMinutes(new Date(wallClock), timeZone) * 60_000;
  return new Date(wallClock - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000);
}

/** Every member's display name by `app_user.id` — a club roster is small, so one read beats one per row. */
async function memberNames(db: Queryable): Promise<Map<string, string>> {
  const result = await db.execute<{ id: string; name: string }>(
    sql`SELECT au."id", u."name" FROM "app_user" au JOIN auth."user" u ON u."id" = au."auth_user_id"`,
  );
  return new Map(result.rows.map((row) => [row.id, row.name]));
}

/** How a field reads on the card: dates as ISO strings, absent as null. */
function display(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** A diff row for each field the model actually set — `undefined` means untouched. */
function fieldDiffs(
  before: Record<string, Date | string | null | undefined>,
  after: Record<string, Date | string | null | undefined>,
): ResolvedFieldDiff[] {
  return Object.entries(after)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => ({ field, before: display(before[field]), after: display(value) }));
}

/**
 * Turns what the model staged (handles, offsets) into what the card shows and
 * the apply endpoint takes (ids, names, absolute dates). Handles stop here:
 * nothing past this function carries one, which is what lets apply accept
 * plain ids and re-check each against the caller's own permissions. A handle
 * the run never issued, or one naming the wrong kind of row, fails the turn
 * closed with `AiOutputError` rather than guessing.
 */
export async function resolveProposal(
  db: Queryable,
  handles: HandleMap,
  staged: AiProposal,
  timeZone: string,
): Promise<AiResolvedProposal | null> {
  const names = await memberNames(db);
  const person = (handle: string) => {
    const id = handles.resolve(handle);
    const name = names.get(id);
    if (name === undefined) throw new AiOutputError(`${handle} is not a member.`);
    return { id, name };
  };
  const eventStart = async (id: string): Promise<Date> => {
    const [row] = await db
      .select({ startsAt: events.startsAt })
      .from(events)
      .where(eq(events.id, id));
    if (!row) throw new AiOutputError("The assistant referred to an event that does not exist.");
    return row.startsAt;
  };

  const resolved: AiResolvedProposal = {};
  if (staged.createEvent) resolved.createEvent = staged.createEvent;

  if (staged.createTasks?.length) {
    resolved.createTasks = await Promise.all(
      staged.createTasks.map(async (task) => {
        if (task.eventRef && task.eventRef !== staged.createEvent?.ref) {
          throw new AiOutputError(
            `The assistant referred to ${task.eventRef}, which it never proposed.`,
          );
        }
        const eventId = task.eventHandle ? handles.resolve(task.eventHandle) : undefined;
        const anchor = task.eventRef
          ? staged.createEvent!.startsAt
          : eventId
            ? await eventStart(eventId)
            : undefined;
        return {
          title: task.title,
          description: task.description,
          priority: task.priority,
          // An offset with no event to count from has no meaning, so it is dropped.
          dueAt:
            task.dueOffsetDays !== undefined && anchor
              ? dueAtFromOffset(anchor, task.dueOffsetDays, timeZone)
              : null,
          assignees: task.assigneeHandles.map(person),
          eventRef: task.eventRef,
          eventId,
        };
      }),
    );
  }

  if (staged.updateTasks?.length) {
    resolved.updateTasks = await Promise.all(
      staged.updateTasks.map(async ({ handle, assigneeHandles, ...changes }) => {
        const id = handles.resolve(handle);
        const [row] = await db
          .select({
            title: tasks.title,
            description: tasks.description,
            priority: tasks.priority,
            dueAt: tasks.dueAt,
          })
          .from(tasks)
          .where(eq(tasks.id, id));
        if (!row) throw new AiOutputError(`${handle} is not a task.`);
        const holders = await db
          .select({ userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(eq(taskAssignees.taskId, id));
        const nameList = (ids: readonly string[]) =>
          ids.map((userId) => names.get(userId) ?? "").join(", ");
        return {
          id,
          title: row.title,
          diffs: fieldDiffs(
            { ...row, assignees: nameList(holders.map((holder) => holder.userId)) },
            {
              ...changes,
              assignees: assigneeHandles
                ? nameList(assigneeHandles.map((assignee) => person(assignee).id))
                : undefined,
            },
          ),
        };
      }),
    );
  }

  if (staged.updateEvent) {
    const { handle, ...changes } = staged.updateEvent;
    const id = handles.resolve(handle);
    const [row] = await db
      .select({
        title: events.title,
        description: events.description,
        venue: events.venue,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        status: events.status,
      })
      .from(events)
      .where(eq(events.id, id));
    if (!row) throw new AiOutputError(`${handle} is not an event.`);
    resolved.updateEvent = { id, title: row.title, diffs: fieldDiffs(row, changes) };
  }

  return Object.keys(resolved).length > 0 ? aiResolvedProposalSchema.parse(resolved) : null;
}
