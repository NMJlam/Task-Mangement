import { eventStatusSchema, type EventStatus } from "@ctp/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { notBlank, sqlEnumValues } from "./sql-enum.js";

/**
 * An event. Note there is no team_id — several teams contribute to one event,
 * and each owes a deliverable. That relationship is `workstream`.
 *
 * 'cancelled' IS the soft delete, and status alone carries it. There is no
 * deleted_at, because RESTRICT on expense.event_id already makes a destructive
 * delete impossible, and a soft-delete flag that leaks from one query is worse
 * than a hard delete.
 *
 * `owner` is NOT the `creator` audit_log would give you — it is an
 * AUTHORISATION input (the `PATCH` rule is "lead+ or owner"), so it must be a
 * live, queryable column rather than a fact buried in an append-only,
 * actor-nullable log. `ON DELETE SET NULL`: a departed owner leaves the event
 * editable by lead+ only, never orphaned.
 *
 * TODO(R9): location, recurrence, attendees. Attendees may turn out to be
 * `workstream` plus `team_member` rather than a column — check before adding one.
 */
export const events = pgTable(
  "event",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    venue: text("venue"),

    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    status: text("status").$type<EventStatus>().notNull().default("planning"),

    // This event's slice of settings.budget_cents, in integer cents. A different
    // number from the pool; conflating them is how overspend goes unnoticed.
    allocationCents: bigint("allocation_cents", { mode: "number" }).notNull().default(0),

    attendanceEstimate: integer("attendance_estimate"),

    minTier: smallint("min_tier").notNull().default(0),

    owner: uuid("owner").references(() => appUsers.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Hot read: the calendar / upcoming list, ordered by date.
    index("event_starts_at_idx").on(table.startsAt.desc()),
    check("event_title_not_blank_check", notBlank(table.title)),
    check(
      "event_status_check",
      sql`${table.status} IN (${sqlEnumValues(eventStatusSchema.options)})`,
    ),
    check("event_allocation_non_negative_check", sql`${table.allocationCents} >= 0`),
    check("event_min_tier_range_check", sql`${table.minTier} BETWEEN 0 AND 2`),
    check(
      "event_ends_after_start_check",
      sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`,
    ),
    check(
      "event_attendance_estimate_non_negative_check",
      sql`${table.attendanceEstimate} IS NULL OR ${table.attendanceEstimate} >= 0`,
    ),
  ],
);
