import {
  expenseCategorySchema,
  expenseStatusSchema,
  type ExpenseCategory,
  type ExpenseStatus,
} from "@ctp/shared";
import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { events } from "./event.js";
import { notBlank, sqlEnumValues } from "./sql-enum.js";
import { teams } from "./team.js";

/**
 * The whole money domain is this table plus two columns elsewhere:
 * settings.budget_cents is the pool, event.allocation_cents divides it, and
 * expense records what actually left. The first two were one-to-one with rows
 * that already existed, so they are columns rather than tables.
 *
 * status runs pending -> approved -> paid, or pending -> rejected. Every
 * transition is a guarded update (rule 9).
 */
export const expenses = pgTable(
  "expense",
  {
    id: uuid("id").primaryKey(),

    // RESTRICT, not cascade: deleting an event must never erase its ledger.
    // This is also what makes event soft-deletion unnecessary.
    eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),

    // Also RESTRICT. Spend-by-team is a question a director will ask, and SET
    // NULL here would quietly destroy the answer for past periods.
    // Consequence: a team with recorded spend cannot be deleted. Rename it.
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "restrict" }),

    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),

    // What the money was actually for. Approving a bare amount and category is
    // not a functional approval workflow.
    description: text("description").notNull(),

    category: text("category").$type<ExpenseCategory>().notNull(),

    status: text("status").$type<ExpenseStatus>().notNull().default("pending"),

    submitter: uuid("submitter").references(() => appUsers.id, { onDelete: "set null" }),
    decider: uuid("decider").references(() => appUsers.id, { onDelete: "set null" }),

    // Financial evidence belonging to the record it evidences, so a column
    // rather than an attachment reference. Storage key; sign on read.
    receiptKey: text("receipt_key"),

    rejectionReason: text("rejection_reason"),

    decidedAt: timestamp("decided_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // No index on event_id or team_id. Per-event ledgers and spend-by-team are
  // report queries over a few hundred rows a year; a sequential scan beats
  // maintaining an index no user's latency depends on.
  (table) => [
    // Hot read: the treasurer's approval queue, and the badge counting it.
    index("expense_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),

    check("expense_amount_positive_check", sql`${table.amountCents} > 0`),
    check("expense_description_not_blank_check", notBlank(table.description)),
    check(
      "expense_category_check",
      sql`${table.category} IN (${sqlEnumValues(expenseCategorySchema.options)})`,
    ),
    check(
      "expense_status_check",
      sql`${table.status} IN (${sqlEnumValues(expenseStatusSchema.options)})`,
    ),
    check(
      "expense_rejection_reason_matches_status_check",
      sql`(${table.status} = 'rejected') = (${table.rejectionReason} IS NOT NULL)`,
    ),

    // Separation of duty. Written this way, NOT as
    // `decider IS DISTINCT FROM submitter`: that form returns FALSE for two
    // NULLs, a CHECK is violated only by FALSE, and both columns go NULL when a
    // member is removed, so the obvious form would block member deletion.
    check(
      "expense_decider_is_not_submitter_check",
      sql`${table.decider} IS NULL OR ${table.decider} <> ${table.submitter}`,
    ),

    check(
      "expense_decided_at_matches_status_check",
      sql`(${table.status} = 'pending') = (${table.decidedAt} IS NULL)`,
    ),
    check(
      "expense_paid_at_matches_status_check",
      sql`(${table.status} = 'paid') = (${table.paidAt} IS NOT NULL)`,
    ),
  ],
);
