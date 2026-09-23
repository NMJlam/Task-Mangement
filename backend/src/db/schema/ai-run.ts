import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { channels } from "./channel.js";
import { uuidShape } from "./sql-uuid.js";

/**
 * One assistant invocation.
 *
 * THE AI ACTS AS THE REQUESTING USER: it calls the same service functions the
 * HTTP routes call, so it inherits their permissions and cannot exceed them.
 * There is no separate write path and no proposal-and-accept table.
 *
 * Rule 13: money mutations are never exposed as AI tools. Approving an expense
 * is the one action where a hallucination costs real money.
 */
export const aiRuns = pgTable(
  "ai_run",
  {
    id: uuid("id").primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    userId: uuid("user_id").references(() => appUsers.id, { onDelete: "set null" }),

    prompt: text("prompt").notNull(),

    // The tool trace: which tools ran, inputs, outputs, timings. This is what
    // makes "agentic" auditable — you can show the committee what the assistant
    // read before it acted. JSON is right because nothing is ever queried across
    // runs.
    steps: jsonb("steps")
      .notNull()
      .default(sql`'[]'::jsonb`),

    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),

    // What the member did with what was proposed, captured from the
    // confirmation they were already making. Null until a card is applied;
    // a run that only answered a question never sets them.
    proposedCount: integer("proposed_count"),
    keptCount: integer("kept_count"),
    editedCount: integer("edited_count"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ai_run_cost_non_negative_check", sql`${table.costMicroUsd} >= 0`),
    check(
      "ai_run_counts_non_negative_check",
      sql`(${table.proposedCount} IS NULL OR ${table.proposedCount} >= 0)
          AND (${table.keptCount} IS NULL OR ${table.keptCount} >= 0)
          AND (${table.editedCount} IS NULL OR ${table.editedCount} >= 0)`,
    ),
    check(
      "ai_run_kept_within_proposed_check",
      sql`${table.keptCount} IS NULL OR ${table.proposedCount} IS NULL
          OR ${table.keptCount} <= ${table.proposedCount}`,
    ),
    check("ai_run_uuid_shape_check", uuidShape(table.id, table.channelId, table.userId)),
  ],
);
