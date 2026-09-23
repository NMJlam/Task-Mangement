import type { Thread, Tier } from "@ctp/shared";
import { and, asc, eq, inArray, lte, max, or, sql, type SQL } from "drizzle-orm";
import { chanMembers, channels, events, messages } from "../../db/schema/index.js";
import { visibleEvents, type Queryable } from "../events/service.js";

/**
 * Thread rules, framework-free like `routes/events/service.ts`, so the pure
 * half is unit-tested with no database.
 */

export interface Viewer {
  id: string;
  tier: Tier;
}

/** The kinds gated by a `chan_member` row rather than by `min_tier`. */
const MEMBERSHIP_KINDS = ["group", "dm", "ai"] as const;

function isMembershipKind(kind: Thread["kind"]): boolean {
  return (MEMBERSHIP_KINDS as readonly string[]).includes(kind);
}

/** `EXISTS` a `chan_member` row putting `userId` in the thread being filtered. */
export function hasMember(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${chanMembers} WHERE ${chanMembers.channelId} = ${channels.id} AND ${chanMembers.userId} = ${userId})`;
}

/**
 * The two visibility mechanisms from `schema/channel.ts`, in one place so no
 * read forgets one:
 *
 *   team, event   -> min_tier at or below yours
 *   group, dm, ai -> you have a chan_member row
 *
 * An event thread also needs its event to be visible. Its `min_tier` is copied
 * from the event when `POST /api/events` opens it and nothing keeps the two in
 * step afterwards, and a cancelled event's thread should go with the event.
 */
export function visibleThreads(viewer: Viewer): SQL {
  return or(
    and(eq(channels.kind, "team"), lte(channels.minTier, viewer.tier)),
    and(
      eq(channels.kind, "event"),
      lte(channels.minTier, viewer.tier),
      sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${channels.eventId} AND ${visibleEvents(viewer.tier)})`,
    ),
    and(inArray(channels.kind, [...MEMBERSHIP_KINDS]), hasMember(viewer.id)),
  )!;
}

/**
 * The thread matching `where`, and whether the viewer may see it. One query
 * answers both because the task routes treat the two misses differently: no
 * thread is a 409, a hidden one a 404. Oldest first when several match.
 */
export async function findThread(
  db: Queryable,
  viewer: Viewer,
  where: SQL,
): Promise<{ id: string; visible: boolean } | undefined> {
  const [thread] = await db
    .select({ id: channels.id, visible: sql<boolean>`${visibleThreads(viewer)}` })
    .from(channels)
    .where(where)
    .orderBy(asc(channels.createdAt), asc(channels.id))
    .limit(1);
  return thread;
}

/** 403 — the caller may not read this channel. Mapped by the route, in the same style as `routes/events/service.ts`'s typed errors. */
export class ChannelForbiddenError extends Error {
  constructor(message = "You do not have access to this channel.") {
    super(message);
    this.name = "ChannelForbiddenError";
  }
}

/**
 * Throws unless `viewer` may read `channelId`. The assistant needs a one-call
 * gate, but the RULE stays `visibleThreads` — a second implementation is how a
 * member ends up able to read through the assistant what they cannot read
 * through the threads route.
 */
export async function assertCanReadChannel(
  db: Queryable,
  viewer: Viewer,
  channelId: string,
): Promise<void> {
  const thread = await findThread(db, viewer, eq(channels.id, channelId));
  if (!thread?.visible) throw new ChannelForbiddenError();
}

/**
 * Where a task's comments and files land: its event's thread if it has an
 * event, otherwise its team's. Never a fallback from one to the other — R9
 * puts task discussion in the event thread, and an event thread carries the
 * event's `min_tier` where a team thread would show a hidden event's task to
 * the whole team. Undefined for standing work with neither.
 *
 * An event can have several threads; `findThread` takes the oldest, which is
 * the one `POST /api/events` opened.
 */
export function taskThreadFilter(task: {
  eventId: string | null;
  teamId: string | null;
}): SQL | undefined {
  if (task.eventId) return and(eq(channels.kind, "event"), eq(channels.eventId, task.eventId));
  if (task.teamId) return and(eq(channels.kind, "team"), eq(channels.teamId, task.teamId));
  return undefined;
}

/**
 * The summaries behind every thread response, newest activity first. Three
 * reads joined in memory, like `GET /api/teams`: a club has tens of threads.
 */
export async function listThreads(db: Queryable, viewer: Viewer, filter?: SQL): Promise<Thread[]> {
  const rows = await db
    .select()
    .from(channels)
    .where(and(visibleThreads(viewer), filter));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [links, stats] = await Promise.all([
    db.select().from(chanMembers).where(inArray(chanMembers.channelId, ids)),
    db
      .select({
        channelId: messages.channelId,
        lastMessageAt: max(messages.createdAt),
        // A missing read row means never opened, so everything is unread.
        // Your own messages never are.
        unreadCount:
          sql<number>`count(*) FILTER (WHERE ${messages.createdAt} > COALESCE(${chanMembers.lastReadAt}, '-infinity'::timestamptz) AND ${messages.author} IS DISTINCT FROM ${viewer.id})`.mapWith(
            Number,
          ),
      })
      .from(messages)
      .leftJoin(
        chanMembers,
        and(eq(chanMembers.channelId, messages.channelId), eq(chanMembers.userId, viewer.id)),
      )
      .where(inArray(messages.channelId, ids))
      .groupBy(messages.channelId),
  ]);

  return rows
    .map((row) => {
      const stat = stats.find((candidate) => candidate.channelId === row.id);
      const mine = links.find((link) => link.channelId === row.id && link.userId === viewer.id);
      return {
        ...row,
        memberIds: isMembershipKind(row.kind)
          ? links.filter((link) => link.channelId === row.id).map((link) => link.userId)
          : [],
        lastReadAt: mine?.lastReadAt ?? null,
        unreadCount: stat?.unreadCount ?? 0,
        lastMessageAt: stat?.lastMessageAt ?? null,
      };
    })
    .sort((a, b) => activity(b) - activity(a));
}

function activity(thread: Thread): number {
  return (thread.lastMessageAt ?? thread.createdAt).getTime();
}

/**
 * Rule 11: replies stay one level deep. A parent must exist in the same thread
 * and must not itself be a reply. Returns the field message, or undefined when
 * the reply is fine.
 */
export function replyProblem(
  parent: { channelId: string; parentId: string | null } | undefined,
  channelId: string,
): string | undefined {
  if (!parent || parent.channelId !== channelId) return "No message with that id in this thread";
  if (parent.parentId) return "Replies are one level deep — reply to the original message";
  return undefined;
}

/** Who hears about a comment on a task: every assignee and the creator, each
 * once, never the author. */
export function commentRecipients(
  task: { assigneeIds: readonly string[]; creator: string | null },
  authorId: string,
): string[] {
  return [...new Set([...task.assigneeIds, task.creator])].filter(
    (id): id is string => id !== null && id !== authorId,
  );
}

/** Escapes LIKE's wildcards, so searching for "50%" finds "50%", not "50". */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}
