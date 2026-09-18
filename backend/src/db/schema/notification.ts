import { notificationKindSchema, type NotificationKind } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUsers } from "./app-user.js";
import { sqlEnumValues } from "./sql-enum.js";
import { uuidShape } from "./sql-uuid.js";

export const notifications = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey(),

    // One row per recipient, fanned out at write time, so the read path is a
    // single indexed scan. A badge polled on every screen needs that.
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),

    kind: text("kind").$type<NotificationKind>().notNull(),

    // Rendered server-side in full, so the in-app feed and any email read
    // identically.
    body: text("body").notNull(),

    // (type, id) with NO foreign key: it is a deep-link target, and one table
    // serves every entity type.
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),

    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Hot read: the notification feed.
    index("notification_feed_idx").on(table.userId, table.createdAt.desc()),

    // Hotter read: the unread badge, on every screen. Partial keeps it tiny.
    index("notification_unread_idx")
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),

    check(
      "notification_kind_check",
      sql`${table.kind} IN (${sqlEnumValues(notificationKindSchema.options)})`,
    ),
    check(
      "notification_entity_all_or_nothing_check",
      sql`num_nulls(${table.entityType}, ${table.entityId}) IN (0, 2)`,
    ),
    check("notification_uuid_shape_check", uuidShape(table.id, table.userId, table.entityId)),
  ],
);
