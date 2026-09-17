import {
  createAttachmentSchema,
  createMessageSchema,
  createThreadSchema,
  listMessagesQuerySchema,
  listThreadsQuerySchema,
  taskParamsSchema,
  threadParamsSchema,
  type CreateAttachment,
  type CreateMessage,
  type CreateThread,
  type ListMessagesQuery,
  type ListThreadsQuery,
  type MessageListResponse,
  type MessageResponse,
  type ThreadListResponse,
  type ThreadResponse,
} from "@ctp/shared";
import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import {
  appUsers,
  chanMembers,
  channels,
  messages,
  notifications,
  tasks,
} from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";
import {
  commentRecipients,
  escapeLike,
  findThread,
  hasMember,
  listThreads,
  replyProblem,
  taskThreadFilter,
  type Viewer,
} from "./service.js";

export const threadsRouter = Router();

/**
 * Threads, messages, task comments and task files — R9 (event threads, US-13),
 * R10 (messaging, US-05), R11 (file sharing, US-12).
 *
 * A thread is a `channel` row, and its kind decides who sees it (see
 * `visibleThreads`). A thread you cannot see answers 404, never 403 — the same
 * rule events follow, since a 403 would confirm it exists.
 *
 * Team and event threads open with their team or event, so `POST /api/threads`
 * only starts conversations. The two `/tasks/:id` routes live here rather than
 * in `tasks.ts` because a comment IS a message: it lands in the task's thread
 * and carries `task_id`, so it shows in both places.
 *
 * Tier 0 throughout, with no new `CAPABILITIES` entry: who may read or post is
 * decided per thread, not by rank.
 */

function threadNotFound(res: Response): void {
  res.status(404).json({ error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } });
}

function taskNotFound(res: Response): void {
  res.status(404).json({ error: { code: "TASK_NOT_FOUND", message: "Task not found." } });
}

function fieldError(res: Response, field: string, message: string): void {
  res.status(422).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      fields: { [field]: [message] },
    },
  });
}

/** Rule 11, checked against the stored parent. */
async function parentProblem(channelId: string, parentId: string): Promise<string | undefined> {
  const [parent] = await getDb()
    .select({ channelId: messages.channelId, parentId: messages.parentId })
    .from(messages)
    .where(eq(messages.id, parentId))
    .limit(1);
  return replyProblem(parent, channelId);
}

// ── GET /api/threads ─────────────────────────────────────────────────────────

threadsRouter.get(
  "/threads",
  authenticate,
  authorise(0),
  validate(listThreadsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = res.locals.validated as ListThreadsQuery;
      const threads = await listThreads(
        getDb(),
        req.user!,
        query.kind ? eq(channels.kind, query.kind) : undefined,
      );
      res.status(200).json({ threads } satisfies ThreadListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/threads ────────────────────────────────────────────────────────

threadsRouter.post(
  "/threads",
  authenticate,
  authorise(0),
  validate(createThreadSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateThread;
      const me = req.user!;
      const others = [...new Set(input.kind === "dm" ? [input.memberId] : input.memberIds)].filter(
        (id) => id !== me.id,
      );
      if (input.kind === "dm" && others.length === 0) {
        fieldError(res, "memberId", "You cannot start a dm with yourself");
        return;
      }

      const db = getDb();
      if (others.length > 0) {
        const found = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(inArray(appUsers.id, others));
        const missing = others.find((id) => !found.some((row) => row.id === id));
        if (missing) {
          res.status(422).json({
            error: { code: "MEMBER_NOT_FOUND", message: `No member with id ${missing}.` },
          });
          return;
        }
      }

      const { id, created } = await db.transaction(async (tx) => {
        if (input.kind === "dm") {
          // A pair has one dm. The lock serialises two starts for the same pair,
          // so a double-click (or both people at once) cannot open a second.
          const pair = [me.id, others[0]!].sort().join(":");
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`dm:${pair}`}))`);
          const [existing] = await tx
            .select({ id: channels.id })
            .from(channels)
            .where(and(eq(channels.kind, "dm"), hasMember(me.id), hasMember(others[0]!)))
            .limit(1);
          if (existing) return { id: existing.id, created: false };
        }

        const threadId = newId();
        await tx.insert(channels).values({
          id: threadId,
          kind: input.kind,
          name: input.kind === "group" ? input.name : null,
        });
        await tx
          .insert(chanMembers)
          .values([me.id, ...others].map((userId) => ({ channelId: threadId, userId })));
        return { id: threadId, created: true };
      });

      const [thread] = await listThreads(db, me, eq(channels.id, id));
      res.status(created ? 201 : 200).json({ thread: thread! } satisfies ThreadResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── GET /api/threads/:id/messages ────────────────────────────────────────────

threadsRouter.get(
  "/threads/:id/messages",
  authenticate,
  authorise(0),
  validate(threadParamsSchema, "params"),
  validate(listMessagesQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = res.locals.validated as ListMessagesQuery;
      const db = getDb();
      const thread = await findThread(db, req.user!, eq(channels.id, req.params.id!));
      if (!thread?.visible) {
        threadNotFound(res);
        return;
      }

      const filters: SQL[] = [eq(messages.channelId, thread.id)];
      if (query.before) {
        const [cursor] = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.id, query.before), eq(messages.channelId, thread.id)))
          .limit(1);
        if (!cursor) {
          res.status(422).json({
            error: { code: "INVALID_CURSOR", message: "before is not a message in this thread." },
          });
          return;
        }
        // Compared in SQL, not against a JS Date: created_at has microseconds and
        // a Date only milliseconds, so a round trip would skip or repeat rows.
        filters.push(
          sql`(${messages.createdAt}, ${messages.id}) < (SELECT "created_at", "id" FROM ${messages} WHERE "id" = ${cursor.id})`,
        );
      }
      if (query.q) filters.push(ilike(messages.body, `%${escapeLike(query.q)}%`));

      // One extra row says whether another page exists.
      const rows = await db
        .select()
        .from(messages)
        .where(and(...filters))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const nextCursor = rows.length > query.limit ? page.at(-1)!.id : null;

      // TODO(R11): sign fileKey into a download URL once file storage exists.
      res.status(200).json({ messages: page, nextCursor } satisfies MessageListResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/threads/:id/messages ───────────────────────────────────────────

threadsRouter.post(
  "/threads/:id/messages",
  authenticate,
  authorise(0),
  validate(threadParamsSchema, "params"),
  validate(createMessageSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateMessage;
      const db = getDb();
      const thread = await findThread(db, req.user!, eq(channels.id, req.params.id!));
      if (!thread?.visible) {
        threadNotFound(res);
        return;
      }
      if (input.parentId) {
        const problem = await parentProblem(thread.id, input.parentId);
        if (problem) {
          fieldError(res, "parentId", problem);
          return;
        }
      }

      // `author` is stamped from the session, never the body.
      const [message] = await db
        .insert(messages)
        .values({
          id: newId(),
          channelId: thread.id,
          author: req.user!.id,
          body: input.body,
          parentId: input.parentId ?? null,
        })
        .returning();
      res.status(201).json({ message: message! } satisfies MessageResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/threads/:id/read ───────────────────────────────────────────────

threadsRouter.post(
  "/threads/:id/read",
  authenticate,
  authorise(0),
  validate(threadParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const viewer = req.user!;
      const db = getDb();
      const thread = await findThread(db, viewer, eq(channels.id, req.params.id!));
      if (!thread?.visible) {
        threadNotFound(res);
        return;
      }

      // On a team or event thread this is the first chan_member row the caller
      // gets — read state only, since min_tier still decides who sees it. The
      // database clock stamps it, the same clock that stamps created_at.
      await db
        .insert(chanMembers)
        .values({ channelId: thread.id, userId: viewer.id, lastReadAt: sql`now()` })
        .onConflictDoUpdate({
          target: [chanMembers.channelId, chanMembers.userId],
          set: { lastReadAt: sql`now()` },
        });

      const [updated] = await listThreads(db, viewer, eq(channels.id, thread.id));
      res.status(200).json({ thread: updated! } satisfies ThreadResponse);
    } catch (error) {
      next(error);
    }
  },
);

// ── POST /api/tasks/:id/comments and /api/tasks/:id/attachments ──────────────

type TaskMessage = Pick<
  typeof messages.$inferInsert,
  "body" | "parentId" | "fileKey" | "fileName" | "fileSizeBytes" | "fileMime"
>;

/**
 * Comments and files differ only in what they write: resolve the task's thread,
 * check the reply, then write the message and notify the task's people in one
 * transaction, so no notification points at a message that failed to land.
 */
async function postToTask(
  req: Request,
  res: Response,
  values: TaskMessage,
  describe: (taskTitle: string) => string,
): Promise<void> {
  const viewer: Viewer = req.user!;
  const db = getDb();
  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      eventId: tasks.eventId,
      teamId: tasks.teamId,
      assignee: tasks.assignee,
      creator: tasks.creator,
    })
    .from(tasks)
    .where(eq(tasks.id, req.params.id!))
    .limit(1);
  if (!task) {
    taskNotFound(res);
    return;
  }

  const target = taskThreadFilter(task);
  const thread = target ? await findThread(db, viewer, target) : undefined;
  if (!thread) {
    res.status(409).json({
      error: {
        code: "NO_THREAD",
        message: "This task has no thread to post in. Link it to an event or a team first.",
      },
    });
    return;
  }
  // A task reached through a thread you cannot see stays hidden, as one reached
  // through an event above your tier does.
  if (!thread.visible) {
    taskNotFound(res);
    return;
  }
  if (values.parentId) {
    const problem = await parentProblem(thread.id, values.parentId);
    if (problem) {
      fieldError(res, "parentId", problem);
      return;
    }
  }

  const message = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({ id: newId(), channelId: thread.id, taskId: task.id, author: viewer.id, ...values })
      .returning();

    const recipients = commentRecipients(task, viewer.id);
    if (recipients.length > 0) {
      await tx.insert(notifications).values(
        recipients.map((userId) => ({
          id: newId(),
          userId,
          kind: "task_commented" as const,
          body: describe(task.title),
          entityType: "task",
          entityId: task.id,
        })),
      );
    }
    return row!;
  });

  res.status(201).json({ message } satisfies MessageResponse);
}

threadsRouter.post(
  "/tasks/:id/comments",
  authenticate,
  authorise(0),
  validate(taskParamsSchema, "params"),
  validate(createMessageSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateMessage;
      await postToTask(
        req,
        res,
        { body: input.body, parentId: input.parentId ?? null },
        (title) => `New comment on "${title}".`,
      );
    } catch (error) {
      next(error);
    }
  },
);

threadsRouter.post(
  "/tasks/:id/attachments",
  authenticate,
  authorise(0),
  validate(taskParamsSchema, "params"),
  validate(createAttachmentSchema),
  async (req, res, next) => {
    try {
      // TODO(R11): no file storage exists yet, so this records a file the client
      // has already uploaded under `fileKey`. Issuing upload URLs is the follow-up.
      const { body, ...file } = res.locals.validated as CreateAttachment;
      await postToTask(
        req,
        res,
        { body, ...file },
        (title) => `New file on "${title}": ${file.fileName}`,
      );
    } catch (error) {
      next(error);
    }
  },
);
