import type { Role, Tier } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const appUsers = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey(),
    authUserId: text("auth_user_id").notNull().unique(),
    role: text("role").$type<Role>().notNull(),
    tier: smallint("tier")
      .$type<Tier>()
      .notNull()
      .generatedAlwaysAs(
        sql`CASE role
          WHEN 'president' THEN 2
          WHEN 'vice_president' THEN 2
          WHEN 'treasurer' THEN 2
          WHEN 'secretary' THEN 2
          WHEN 'marketing_director' THEN 1
          WHEN 'officer' THEN 0
        END`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "app_user_role_check",
      sql`${table.role} IN ('president', 'vice_president', 'treasurer', 'secretary', 'marketing_director', 'officer')`,
    ),
  ],
);
