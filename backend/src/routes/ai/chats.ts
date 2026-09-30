import type { AiChat } from "@ctp/shared";
import { and, eq, sql } from "drizzle-orm";
import { newId } from "../../db/id.js";
import { chanMembers, channels } from "../../db/schema/index.js";
import type { Queryable, Tx } from "../events/service.js";

/**
 * The rules of an assistant chat. A chat is a `channel` of kind `ai` whose only
 * member is its owner (spec M1) — so "is this the caller's chat?" is one join,
 * and everything here asks it the same way. Framework-free, like
 * `routes/events/service.ts`: the router maps what this throws.
 */

export const AI_CHAT_TITLE_LENGTH = 60;

/** A chat is named by what the member first asked: one line, cut to fit the list. */
export function chatTitleFrom(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length <= AI_CHAT_TITLE_LENGTH
    ? line
    : `${line.slice(0, AI_CHAT_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * 404 — not the caller's chat, or no such chat. The two are deliberately
 * indistinguishable: a 403 would confirm that a chat with that id exists.
 */
export class ChatNotFoundError extends Error {
  constructor(message = "Chat not found.") {
    super(message);
    this.name = "ChatNotFoundError";
  }
}

export type ChatRow = { id: string; title: string; seedEventId: string | null; createdAt: Date };

export async function findChat(
  db: Queryable,
  userId: string,
  chatId: string,
): Promise<ChatRow | undefined> {
  const [row] = await db
    .select({
      id: channels.id,
      title: channels.name,
      seedEventId: channels.seedEventId,
      createdAt: channels.createdAt,
    })
    .from(channels)
    .innerJoin(chanMembers, eq(chanMembers.channelId, channels.id))
    .where(and(eq(channels.id, chatId), eq(channels.kind, "ai"), eq(chanMembers.userId, userId)))
    .limit(1);
  // `name` is nullable in the table only for dms; an ai channel always has one.
  return row ? { ...row, title: row.title ?? "" } : undefined;
}

export async function requireChat(db: Queryable, userId: string, chatId: string): Promise<ChatRow> {
  const chat = await findChat(db, userId, chatId);
  if (!chat) throw new ChatNotFoundError();
  return chat;
}

type ChatListRow = {
  id: string;
  title: string;
  seedEventId: string | null;
  lastMessageAt: Date;
  createdAt: Date;
};

/**
 * The caller's chats, or just one of them. Most recently active first; a chat
 * with no message yet sorts by when it was made.
 */
async function selectChats(db: Queryable, userId: string, chatId?: string): Promise<AiChat[]> {
  const result = await db.execute<ChatListRow>(sql`
    SELECT c."id", c."name" AS "title", c."seed_event_id" AS "seedEventId",
           COALESCE(MAX(m."created_at"), c."created_at") AS "lastMessageAt",
           c."created_at" AS "createdAt"
    FROM "channel" c
    JOIN "chan_member" cm ON cm."channel_id" = c."id" AND cm."user_id" = ${userId}
    LEFT JOIN "message" m ON m."channel_id" = c."id"
    WHERE c."kind" = 'ai' ${chatId ? sql`AND c."id" = ${chatId}` : sql``}
    GROUP BY c."id"
    ORDER BY "lastMessageAt" DESC, c."id" DESC
  `);
  return result.rows.map((row) => ({
    ...row,
    lastMessageAt: new Date(row.lastMessageAt),
    createdAt: new Date(row.createdAt),
  }));
}

export function listChats(db: Queryable, userId: string): Promise<AiChat[]> {
  return selectChats(db, userId);
}

/** One chat in the shape the list uses, or `ChatNotFoundError`. */
export async function getChat(db: Queryable, userId: string, chatId: string): Promise<AiChat> {
  const [chat] = await selectChats(db, userId, chatId);
  if (!chat) throw new ChatNotFoundError();
  return chat;
}

export async function createChat(
  tx: Tx,
  userId: string,
  args: { title: string; seedEventId: string | null },
): Promise<string> {
  const id = newId();
  await tx
    .insert(channels)
    .values({ id, kind: "ai", name: args.title, seedEventId: args.seedEventId });
  await tx.insert(chanMembers).values({ channelId: id, userId });
  return id;
}

export async function renameChat(
  db: Queryable,
  userId: string,
  chatId: string,
  title: string,
): Promise<AiChat> {
  await requireChat(db, userId, chatId);
  await db.update(channels).set({ name: title }).where(eq(channels.id, chatId));
  return getChat(db, userId, chatId);
}

/**
 * Its messages and membership go by cascade. Its runs stay, their chat link
 * cleared (spec M6): what the chat made keeps its `ai_run_id`, and the
 * kept/edited counts survive for the evaluation.
 */
export async function deleteChat(db: Queryable, userId: string, chatId: string): Promise<void> {
  await requireChat(db, userId, chatId);
  await db.delete(channels).where(eq(channels.id, chatId));
}
