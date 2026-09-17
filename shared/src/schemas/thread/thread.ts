import { z } from "zod";
import { channelKindSchema } from "../channel/channel.js";

/**
 * Thread and message shapes for R9 (event threads, US-13 task comments), R10
 * (messaging, US-05) and R11 (file sharing, US-12).
 *
 * A thread IS a `channel` row — "thread" is the API's word, `channel` the
 * table's — so the id `GET /api/events/:id?include=channel` returns is a thread
 * id. Not to be confused with a reply chain, which is `parentId` on a message.
 */
const bodySchema = z.string().trim().min(1, "Message is required").max(4000);

export const threadSchema = z.object({
  id: z.uuid(),
  kind: channelKindSchema,
  // Null only on a dm, which the client names after the other member.
  name: z.string().nullable(),
  teamId: z.uuid().nullable(),
  eventId: z.uuid().nullable(),
  minTier: z.number().int(),
  createdAt: z.coerce.date(),
  // The member list of a group, dm or ai thread. Always empty on team and event
  // threads: those are gated by minTier, so no list says who is in them.
  memberIds: z.array(z.uuid()),
  // The caller's read state. Null on a team or event thread they have never
  // marked read, in which case every message counts as unread.
  lastReadAt: z.coerce.date().nullable(),
  // Messages after lastReadAt, not counting the caller's own.
  unreadCount: z.number().int().min(0),
  lastMessageAt: z.coerce.date().nullable(),
});

export type Thread = z.infer<typeof threadSchema>;

/** Route params for every /threads/:id endpoint. */
export const threadParamsSchema = z.object({ id: z.uuid() });

// ── GET /api/threads ─────────────────────────────────────────────────────────

/** No pagination, for the reason `listTeamsQuerySchema` gives: a club has tens
 * of threads, not thousands. */
export const listThreadsQuerySchema = z.object({ kind: channelKindSchema.optional() });

export type ListThreadsQuery = z.infer<typeof listThreadsQuerySchema>;

// ── POST /api/threads ────────────────────────────────────────────────────────

/**
 * Only conversations are started here. Team and event threads open with their
 * team or event, and an `ai` thread belongs to the assistant — so `kind` is
 * `group` or `dm`, and anything else is a 422.
 *
 * The caller is always a member; listing yourself is harmless.
 */
export const createThreadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dm"), memberId: z.uuid() }),
  z.object({
    kind: z.literal("group"),
    name: z.string().trim().min(1, "Thread name is required").max(100),
    memberIds: z.array(z.uuid()).max(50).default([]),
  }),
]);

export type CreateThread = z.infer<typeof createThreadSchema>;

// ── Messages ─────────────────────────────────────────────────────────────────

/**
 * Mirrors the `message` table column for column, so a bare `.select()`
 * satisfies it. `channelId` keeps the column's name — it is the thread id.
 * `fileKey` is a storage key, not a URL.
 */
export const messageSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  taskId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  author: z.uuid().nullable(),
  body: z.string(),
  fileKey: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSizeBytes: z.number().int().nullable(),
  fileMime: z.string().nullable(),
  aiRunId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
  editedAt: z.coerce.date().nullable(),
});

export type Message = z.infer<typeof messageSchema>;

// ── GET /api/threads/:id/messages ────────────────────────────────────────────

/**
 * Newest first. `before` is the `nextCursor` of the previous page: a message
 * id, not an offset, because new messages arriving while you scroll back would
 * shift every offset by one. `q` is a case-insensitive keyword match on the
 * body (R10).
 */
export const listMessagesQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

// ── POST /api/threads/:id/messages and POST /api/tasks/:id/comments ──────────

/** A comment is a message, so both routes take this body. `parentId` makes it
 * a reply, one level deep. */
export const createMessageSchema = z.object({
  body: bodySchema,
  parentId: z.uuid().optional(),
});

export type CreateMessage = z.infer<typeof createMessageSchema>;

// ── POST /api/tasks/:id/attachments ──────────────────────────────────────────

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Records a file already uploaded to storage under `fileKey`. The route never
 * sees the bytes: the schema stores keys, not URLs, and signs on read. `body`
 * is an optional caption.
 */
export const createAttachmentSchema = z.object({
  fileKey: z.string().trim().min(1, "File key is required").max(500),
  fileName: z.string().trim().min(1, "File name is required").max(255),
  fileSizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES, "File is larger than 25 MB"),
  fileMime: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[\w.+-]+\/[\w.+-]+$/, "Not a MIME type"),
  body: z.string().trim().max(4000).default(""),
});

export type CreateAttachment = z.infer<typeof createAttachmentSchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export const threadResponseSchema = z.object({ thread: threadSchema });
export const threadListResponseSchema = z.object({ threads: z.array(threadSchema) });
export const messageResponseSchema = z.object({ message: messageSchema });
export const messageListResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.uuid().nullable(),
});

export type ThreadResponse = z.infer<typeof threadResponseSchema>;
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export type MessageListResponse = z.infer<typeof messageListResponseSchema>;
