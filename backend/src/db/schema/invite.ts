import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { SQL_ROLE_LIST } from "./app-user.js";

export const invites = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("invite_email_idx").on(table.email),
    uniqueIndex("invite_open_email_unique")
      .on(table.email)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    check("invite_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
    check(
      "invite_role_check",
      sql`${table.role} IN (${sql.join(
        SQL_ROLE_LIST.map(({ literal }) => literal),
        sql`, `,
      )})`,
    ),
  ],
);
