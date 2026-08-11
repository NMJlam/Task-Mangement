import type { Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    check("invite_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
    check(
      "invite_role_check",
      sql`${table.role} IN ('president', 'vice_president', 'treasurer', 'secretary', 'marketing_director', 'officer')`,
    ),
  ],
);
