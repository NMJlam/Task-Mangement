import { ROLE_TIER, roleSchema, type Role, type Tier } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const SQL_ROLE_LIST = roleSchema.options.map((role) => ({
  literal: sql.raw(`'${role.replaceAll("'", "''")}'`),
  role,
}));

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
          ${sql.join(
            SQL_ROLE_LIST.map(
              ({ literal, role }) => sql`WHEN ${literal} THEN ${sql.raw(String(ROLE_TIER[role]))}`,
            ),
            sql`
          `,
          )}
        END`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "app_user_role_check",
      sql`${table.role} IN (${sql.join(
        SQL_ROLE_LIST.map(({ literal }) => literal),
        sql`, `,
      )})`,
    ),
  ],
);
