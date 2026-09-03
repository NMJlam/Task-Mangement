import { sql } from "drizzle-orm";
import { bigint, check, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";

/**
 * One row, pinned by the CHECK on id. Holds the club-wide budget pool that
 * event.allocation_cents divides up. Later: club name, logo, notification
 * defaults.
 *
 * The row itself is created by db:seed with ON CONFLICT DO NOTHING, so
 * re-running it is safe. Rule 1 (total allocation must not exceed this budget)
 * requires SELECT ... FOR UPDATE on this row, or two people allocating at once
 * both pass and overspend.
 *
 * updated_at is maintained by the service layer; there is no trigger.
 */
export const settings = pgTable(
  "settings",
  {
    id: smallint("id").primaryKey().default(1),
    budgetCents: bigint("budget_cents", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("settings_singleton_check", sql`${table.id} = 1`),
    check("settings_budget_non_negative_check", sql`${table.budgetCents} >= 0`),
  ],
);
