import { channelKindSchema, type ChannelKind } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./event.js";
import { sqlEnumValues } from "./sql-enum.js";
import { teams } from "./team.js";

/**
 * TWO VISIBILITY MECHANISMS, and `kind` decides which applies:
 *
 *   team, event    -> min_tier: everyone at that tier or above
 *   group, dm, ai  -> membership: a chan_member row is required
 *
 * Mixing them makes both incoherent. A private exec channel is a 'group';
 * "directors and up" is a 'team' channel with min_tier = 1.
 *
 * The AI assistant needs no tables of its own — it is kind = 'ai', a dedicated
 * PAGE, not a dedicated schema.
 */
export const channels = pgTable(
  "channel",
  {
    id: uuid("id").primaryKey(),

    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),

    kind: text("kind").$type<ChannelKind>().notNull(),
    name: text("name"),

    minTier: smallint("min_tier").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One board per team is the actual model. Events are deliberately NOT
    // constrained: a big event plausibly wants separate logistics and
    // volunteers channels, and forbidding that buys nothing.
    uniqueIndex("channel_one_per_team")
      .on(table.teamId)
      .where(sql`${table.kind} = 'team'`),

    check(
      "channel_kind_check",
      sql`${table.kind} IN (${sqlEnumValues(channelKindSchema.options)})`,
    ),
    check("channel_min_tier_range_check", sql`${table.minTier} BETWEEN 0 AND 2`),

    check(
      "channel_parent_matches_kind_check",
      sql`CASE ${table.kind}
        WHEN 'team'  THEN ${table.teamId}  IS NOT NULL AND ${table.eventId} IS NULL
        WHEN 'event' THEN ${table.eventId} IS NOT NULL AND ${table.teamId}  IS NULL
        ELSE              ${table.teamId}  IS NULL     AND ${table.eventId} IS NULL
      END`,
    ),

    // Enforces the table above: min_tier is meaningless on a membership-gated
    // channel, so it may not be set there. This is the constraint that stops the
    // two mechanisms bleeding into each other.
    check(
      "channel_min_tier_only_when_tier_gated_check",
      sql`${table.kind} IN ('team', 'event') OR ${table.minTier} = 0`,
    ),

    check(
      "channel_named_unless_dm_check",
      sql`${table.kind} = 'dm' OR (${table.name} IS NOT NULL AND length(trim(${table.name})) > 0)`,
    ),
  ],
);
