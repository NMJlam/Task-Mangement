import { check, index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { channels } from "./channel.js";
import { uuidShape } from "./sql-uuid.js";

/**
 * Membership AND read state in one row. These are commonly two tables with an
 * identical primary key — which means they were one table wearing two hats.
 */
export const chanMembers = pgTable(
  "chan_member",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),

    // High-water mark, so unread is:
    //   count(message) WHERE channel_id = $1 AND created_at > last_read_at
    // One row per person per channel, not one per message read.
    // NOT NULL matters: a NULL here silently breaks that comparison for anyone
    // who has never opened the channel.
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    // Hot read: the sidebar's membership-gated channels plus every unread badge.
    index("chan_member_user_idx").on(table.userId),
    check("chan_member_uuid_shape_check", uuidShape(table.channelId, table.userId)),
  ],
);
