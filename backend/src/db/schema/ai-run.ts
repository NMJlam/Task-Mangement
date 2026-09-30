import {
  aiProposalStatusSchema,
  aiRunKindSchema,
  type AiProposalStatus,
  type AiRunKind,
} from "@ctp/shared";
import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { channels } from "./channel.js";
import { sqlEnumValues } from "./sql-enum.js";
import { uuidShape } from "./sql-uuid.js";

/**
 * One assistant invocation.
 *
 * THE AI ACTS AS THE REQUESTING USER: it calls the same service functions the
 * HTTP routes call, so it inherits their permissions and cannot exceed them.
 * There is no separate write path and no proposal-and-accept table: a drafted
 * plan is a column on the run that drafted it (`result`, `proposal_status`).
 *
 * Rule 13: money mutations are never exposed as AI tools. Approving an expense
 * is the one action where a hallucination costs real money.
 */
export const aiRuns = pgTable(
  "ai_run",
  {
    id: uuid("id").primaryKey(),
    // A chat run points at its chat; a summary run at the thread it summarised;
    // a briefing at nothing. SET NULL, not CASCADE: deleting a chat must not
    // delete its runs — the kept/edited counts below and the ai_run_id on every
    // row a run made both outlive the conversation.
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),

    kind: text("kind").$type<AiRunKind>().notNull().default("chat"),

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

    // chat run: the resolved proposal it drafted, if any. briefing run: the
    // briefing. Read back whole and never queried into, hence JSON.
    result: jsonb("result"),

    // Only on a chat run that drafted a plan: what a reopened chat shows under
    // that reply. `open` until the member applies or discards it.
    proposalStatus: text("proposal_status").$type<AiProposalStatus>(),

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
    check("ai_run_kind_check", sql`${table.kind} IN (${sqlEnumValues(aiRunKindSchema.options)})`),
    check(
      "ai_run_proposal_status_check",
      sql`${table.proposalStatus} IS NULL OR ${table.proposalStatus} IN (${sqlEnumValues(aiProposalStatusSchema.options)})`,
    ),
    check(
      "ai_run_proposal_status_only_on_chat_check",
      sql`${table.proposalStatus} IS NULL OR ${table.kind} = 'chat'`,
    ),
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
