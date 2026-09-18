import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { aiRuns } from "./ai-run.js";
import { appUsers } from "./app-user.js";
import { channels } from "./channel.js";
import { uuidShape } from "./sql-uuid.js";
import { tasks } from "./task.js";

export const messages = pgTable(
  "message",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    // Why task discussion isn't siloed: a comment lives in a channel AND points
    // at a task, so it appears in both the channel and the task drawer,
    // inheriting mentions, threading, unread counts and realtime for free.
    // SET NULL so deleting a task doesn't punch holes in the channel.
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),

    // Self-reference giving reply threads. Kept one level deep by rule 11 —
    // a tree needs recursive reads for a depth nobody uses.
    // SET NULL, not CASCADE: deleting a thread root must not delete other
    // people's replies.
    parentId: uuid("parent_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),

    author: uuid("author").references(() => appUsers.id, { onDelete: "set null" }),

    // Mentions are stored as @[user-id] tokens in the body and resolved
    // client-side against the roster. Display names aren't unique and break on
    // rename.
    body: text("body").notNull().default(""),

    // Attachments are columns, not a table. One file per message. A separate
    // table means a join on the hottest read path, plus orphan cleanup if it's
    // polymorphic. Storage keys, not URLs — sign on read.
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    fileMime: text("file_mime"),

    // Set means the model produced this turn; null means a human typed it.
    // No is_bot boolean, because the run row is already the fact.
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (table) => [
    // THE hottest read in the system: one channel's history, newest first.
    index("message_channel_idx").on(table.channelId, table.createdAt.desc()),

    // Hot read: the task drawer's comments.
    index("message_task_idx")
      .on(table.taskId, table.createdAt)
      .where(sql`${table.taskId} IS NOT NULL`),

    // Hot read: a thread's replies.
    index("message_parent_idx")
      .on(table.parentId)
      .where(sql`${table.parentId} IS NOT NULL`),

    check("message_has_content_check", sql`${table.body} <> '' OR ${table.fileKey} IS NOT NULL`),
    check(
      "message_file_all_or_nothing_check",
      sql`num_nulls(${table.fileKey}, ${table.fileName}, ${table.fileSizeBytes}, ${table.fileMime}) IN (0, 4)`,
    ),
    check(
      "message_file_size_positive_check",
      sql`${table.fileSizeBytes} IS NULL OR ${table.fileSizeBytes} > 0`,
    ),
    check(
      "message_not_own_parent_check",
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    check(
      "message_uuid_shape_check",
      uuidShape(
        table.id,
        table.channelId,
        table.taskId,
        table.parentId,
        table.author,
        table.aiRunId,
      ),
    ),
  ],
);
