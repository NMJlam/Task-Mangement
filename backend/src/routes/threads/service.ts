import type { ChannelKind, DeletingViewer, Message, Thread, Tier } from "@ctp/shared";
import { extractMentionedIds, groupDeletionAuthority, messageDeletionAuthority } from "@ctp/shared";
import { and, asc, eq, gte, inArray, isNull, lte, max, not, or, sql, type SQL } from "drizzle-orm";
import { newId } from "../../db/id.js";
import {
  appUsers,
  auditLog,
  chanMembers,
  channels,
  events,
  messages,
  notifications,
} from "../../db/schema/index.js";
import { ValidationError, type Queryable, type Tx } from "../events/service.js";

/**
 * Thread rules, framework-free like `routes/events/service.ts`, so the pure
 * half is unit-tested with no database.
 */

export interface Viewer {
  id: string;
  tier: Tier;
}

/**
 * The kinds gated by a `chan_member` row rather than by `min_tier`.
 *
 * `ai` is deliberately absent. An assistant chat is a channel too, and its
 * owner is its one member — but it is not a thread: it is served only by
 * routes/ai, under that router's own ownership check. Leaving it out here is
 * what keeps AI chats out of Messages and out of every thread route at once
 * (list, read, post, mark read, mentions), rather than relying on each caller
 * to filter.
 */
const MEMBERSHIP_KINDS = ["group", "dm"] as const;

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
 * An event thread also needs its event's tier to be at or below yours. Its
 * `min_tier` is copied from the event when `POST /api/events` opens it and
 * `PATCH /api/events/:id` keeps the two in step, but the event stays the
 * authority.
 *
 * A CANCELLED event's thread stays visible, as the event itself does by its
 * link (`GET /api/events/:id`): it is a read-only archive (`archivedThread`),
 * kept out of the conversation list and closed to new posts, not a secret.
 *
 * A DELETED group is visible to no one, its own members included: every route
 * that goes through here — list, read, post, mark read, mentions, the
 * assistant's `assertCanReadChannel` — answers as if it had never existed.
 */
export function visibleThreads(viewer: Viewer): SQL {
  return and(
    isNull(channels.deletedAt),
    or(
      and(eq(channels.kind, "team"), lte(channels.minTier, viewer.tier)),
      and(
        eq(channels.kind, "event"),
        lte(channels.minTier, viewer.tier),
        sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${channels.eventId} AND ${lte(events.minTier, viewer.tier)})`,
      ),
      and(inArray(channels.kind, [...MEMBERSHIP_KINDS]), hasMember(viewer.id)),
    ),
  )!;
}

/**
 * An event thread whose event is cancelled: readable, never written to. Read
 * from the event's status on every request rather than stored on the thread,
 * so restoring the event (`cancelled -> planning`) reopens its thread, with
 * its history, without a second write to forget.
 */
export function archivedThread(): SQL {
  return and(
    eq(channels.kind, "event"),
    sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${channels.eventId} AND ${events.status} = 'cancelled')`,
  )!;
}

/** What the conversation list leaves out: a cancelled event's archived thread. */
export function listedThreads(): SQL {
  return not(archivedThread());
}

/**
 * The thread matching `where`, and whether the viewer may see it. One query
 * answers both because the task routes treat the two misses differently: no
 * thread is a 409, a hidden one a 404. Oldest first when several match.
 *
 * Carries `kind`/`minTier`/`eventId` too — the same row already has them, and
 * both message-creation routes need them again right after to resolve
 * mentions via `mentionableIds` — and `createdBy`, which group deletion checks.
 */
export async function findThread(
  db: Queryable,
  viewer: Viewer,
  where: SQL,
): Promise<
  | {
      id: string;
      visible: boolean;
      archived: boolean;
      kind: ChannelKind;
      minTier: Tier;
      eventId: string | null;
      createdBy: string | null;
    }
  | undefined
> {
  const [thread] = await db
    .select({
      id: channels.id,
      visible: sql<boolean>`${visibleThreads(viewer)}`,
      archived: sql<boolean>`${archivedThread()}`,
      kind: channels.kind,
      minTier: sql<Tier>`${channels.minTier}`,
      eventId: channels.eventId,
      createdBy: channels.createdBy,
    })
    .from(channels)
    .where(where)
    .orderBy(asc(channels.createdAt), asc(channels.id))
    .limit(1);
  return thread;
}

/**
 * Takes the thread's row lock for the rest of `tx`, so deleting a group and
 * writing into it cannot interleave. Posting and deleting a message take it
 * SHARED — any number at once — and deleting the group takes it EXCLUSIVELY,
 * so a send either commits before the group goes (and goes with it) or waits
 * and then finds no thread.
 *
 * Call it BEFORE `findThread`, never after: under READ COMMITTED each
 * statement sees what had committed when it began, so it is the read that
 * follows the lock that sees a deletion the lock waited on. Lock order is
 * always the thread, then a message.
 */
export async function lockThread(
  tx: Tx,
  threadId: string,
  mode: "share" | "update",
): Promise<void> {
  await tx.execute(
    sql`SELECT 1 FROM ${channels} WHERE ${channels.id} = ${threadId} FOR ${mode === "update" ? sql`UPDATE` : sql`SHARE`}`,
  );
}

/**
 * A refusal from a thread rule, carrying the status and code the route sends —
 * the way `ApplyError` does for the assistant. Thrown inside the transaction,
 * so whatever it already wrote rolls back with it.
 */
export class ThreadError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ThreadError";
  }
}

export const threadNotFoundError = () =>
  new ThreadError(404, "THREAD_NOT_FOUND", "Thread not found.");

/** 409, not 404: the thread is there and readable, it just takes no writes. */
export const threadArchivedError = () =>
  new ThreadError(409, "THREAD_ARCHIVED", "This event was cancelled, so its thread is read-only.");

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
      // A deleted message is neither unread nor activity: deleting the newest
      // message moves its conversation back to the one before, and deleting
      // them all back to when the conversation was opened.
      .where(and(inArray(messages.channelId, ids), isNull(messages.deletedAt)))
      .groupBy(messages.channelId),
  ]);

  return rows
    .map(({ deletedAt: _deletedAt, deletedBy: _deletedBy, ...row }) => {
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
 *
 * A deleted message takes no NEW replies — there is nothing left to answer —
 * but the replies it already has keep pointing at its tombstone.
 */
export function replyProblem(
  parent: { channelId: string; parentId: string | null; deletedAt: Date | null } | undefined,
  channelId: string,
): string | undefined {
  if (!parent || parent.channelId !== channelId) return "No message with that id in this thread";
  if (parent.deletedAt) return "That message was deleted, so it cannot take new replies";
  if (parent.parentId) return "Replies are one level deep — reply to the original message";
  return undefined;
}

/** Rule 11, checked against the stored parent — inside the caller's transaction. */
export async function parentProblem(
  db: Queryable,
  channelId: string,
  parentId: string,
): Promise<string | undefined> {
  const [parent] = await db
    .select({
      channelId: messages.channelId,
      parentId: messages.parentId,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(eq(messages.id, parentId))
    .limit(1)
    // Serialize the check with deletion: a reply waiting on a tombstone must
    // see the deleted parent before it can be inserted.
    .for("share");
  return replyProblem(parent, channelId);
}

// ── Deletion ──────────────────────────────────────────────────────────────

/**
 * Deletes one message for everyone, leaving its tombstone. Answers in the
 * order the route promises, so nothing leaks: a thread the caller cannot see
 * is 404 before anything is said about the message, and a message is looked
 * up only within that thread, so another thread's id is 404 too.
 *
 * The author may delete their own; `message:delete-any` may delete anyone's.
 * A cancelled event's thread is an archive, closed to deletion as it is to
 * posts — for the president too.
 *
 * Idempotent for whoever may delete it: a second call returns the same
 * tombstone and writes no second audit row.
 */
export async function deleteMessage(
  tx: Tx,
  viewer: Viewer & DeletingViewer,
  threadId: string,
  messageId: string,
): Promise<Message> {
  await lockThread(tx, threadId, "share");
  const thread = await findThread(tx, viewer, eq(channels.id, threadId));
  if (!thread?.visible) throw threadNotFoundError();

  const [message] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.channelId, thread.id)))
    .limit(1)
    .for("update");
  if (!message) throw new ThreadError(404, "MESSAGE_NOT_FOUND", "Message not found.");
  if (thread.archived) throw threadArchivedError();

  const authority = messageDeletionAuthority(viewer, message);
  if (!authority) {
    throw new ThreadError(403, "FORBIDDEN", "You can only delete your own messages.");
  }
  if (message.deletedAt) return message;

  // The words and the file go; who, when and the task/reply links stay.
  const [tombstone] = await tx
    .update(messages)
    .set({
      deletedAt: sql`now()`,
      deletedBy: viewer.id,
      body: "",
      fileKey: null,
      fileName: null,
      fileSizeBytes: null,
      fileMime: null,
    })
    .where(eq(messages.id, message.id))
    .returning();

  // Notifications have no foreign key (`schema/notification.ts`), so a
  // mention of this message would otherwise outlive it. A task comment's
  // notifications point at the TASK and carry no words, so they stay.
  await tx
    .delete(notifications)
    .where(and(eq(notifications.entityType, "message"), eq(notifications.entityId, message.id)));

  // What happened, never what it said.
  await tx.insert(auditLog).values({
    id: newId(),
    actorId: viewer.id,
    action: "message.deleted",
    entityType: "message",
    entityId: message.id,
    changes: { channelId: thread.id, authority },
  });
  return tombstone!;
}

/**
 * Deletes a custom group for every member. Visibility first — a group the
 * caller is not in is 404 whatever their role — then the kind, then the power.
 * The rows stay (a soft delete), but no route serves them again.
 */
export async function deleteGroup(
  tx: Tx,
  viewer: Viewer & DeletingViewer,
  threadId: string,
): Promise<void> {
  await lockThread(tx, threadId, "update");
  const thread = await findThread(tx, viewer, eq(channels.id, threadId));
  if (!thread?.visible) throw threadNotFoundError();
  if (thread.kind !== "group") {
    throw new ThreadError(
      409,
      "THREAD_DELETE_NOT_ALLOWED",
      "Only a group conversation can be deleted.",
    );
  }

  // A visible group is one the caller has a chan_member row in.
  const authority = groupDeletionAuthority(viewer, {
    kind: thread.kind,
    createdBy: thread.createdBy,
    isMember: true,
  });
  if (!authority) throw new ThreadError(403, "FORBIDDEN", "You cannot delete this group.");

  await tx
    .update(channels)
    .set({ deletedAt: sql`now()`, deletedBy: viewer.id })
    .where(eq(channels.id, thread.id));

  // Only rows that point into this group: its messages' mentions, and anything
  // aimed at the thread itself. Another entity type sharing an id stays.
  await tx
    .delete(notifications)
    .where(
      or(
        and(
          eq(notifications.entityType, "message"),
          inArray(
            notifications.entityId,
            tx.select({ id: messages.id }).from(messages).where(eq(messages.channelId, thread.id)),
          ),
        ),
        and(
          inArray(notifications.entityType, ["channel", "thread"]),
          eq(notifications.entityId, thread.id),
        ),
      ),
    );

  await tx.insert(auditLog).values({
    id: newId(),
    actorId: viewer.id,
    action: "group.deleted",
    entityType: "channel",
    entityId: thread.id,
    changes: { authority },
  });
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

// ── @mentions ─────────────────────────────────────────────────────────────

/** The channel columns `mentionableIds` needs — a subset of `channels`, not
 * the full row, so a caller who already has the row can pass it as-is. */
export interface MentionScope {
  id: string;
  kind: ChannelKind;
  minTier: Tier;
  eventId: string | null;
}

const MEMBERSHIP_KINDS_SET = new Set<ChannelKind>(MEMBERSHIP_KINDS);

/**
 * Of `candidateIds`, the ones who may actually see `channel` — the same two
 * rules `visibleThreads` checks for one viewer, run the other way round for
 * many. A mention naming someone who cannot see the thread is dropped here
 * rather than notified: the notification itself would be the leak, confirming
 * a hidden thread exists to someone `visibleThreads` keeps it from. An id that
 * isn't a real app_user at all drops out the same way, with no separate
 * existence check needed.
 */
export async function mentionableIds(
  db: Queryable,
  channel: MentionScope,
  candidateIds: readonly string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];

  if (MEMBERSHIP_KINDS_SET.has(channel.kind)) {
    const rows = await db
      .select({ userId: chanMembers.userId })
      .from(chanMembers)
      .where(and(eq(chanMembers.channelId, channel.id), inArray(chanMembers.userId, candidateIds)));
    return rows.map((row) => row.userId);
  }

  // team or event, gated by tier — event also needs its event visible, the
  // same EXISTS visibleThreads runs, just against a candidate's tier instead
  // of one fixed viewer's, so it isn't reusable as the function directly.
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        inArray(appUsers.id, candidateIds),
        gte(appUsers.tier, channel.minTier),
        channel.kind === "event"
          ? sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${channel.eventId} AND ${lte(events.minTier, appUsers.tier)} AND ${events.status} != 'cancelled')`
          : sql`true`,
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * `@[user-id]` tokens in `body`, turned into `mention` notification rows for
 * whoever both wrote one and can see `channel` — self-mentions never notify,
 * the same way `commentRecipients` drops the comment's own author. Returns
 * rows ready to insert, or `[]`; the caller decides whether to bother with an
 * empty insert. Private-thread mentions of outsiders reject the whole send
 * with a validation error; callers must run this inside their write transaction.
 */
export async function mentionNotifications(
  db: Queryable,
  channel: MentionScope,
  body: string,
  authorId: string,
  message: { id: string },
): Promise<(typeof notifications.$inferInsert)[]> {
  const candidates = extractMentionedIds(body).filter((id) => id !== authorId);
  if (candidates.length === 0) return [];
  const recipients = await mentionableIds(db, channel, candidates);
  if (isMembershipKind(channel.kind) && recipients.length !== candidates.length) {
    throw new ValidationError({ body: ["Mention only people who belong to this conversation."] });
  }
  return recipients.map((userId) => ({
    id: newId(),
    userId,
    kind: "mention" as const,
    body: "You were mentioned in a message.",
    entityType: "message" as const,
    entityId: message.id,
  }));
}
