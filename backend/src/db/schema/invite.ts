import { roleSchema, type Role } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sqlEnumValues } from "./sql-enum.js";

/**
 * The membership gate. An invite pre-assigns the position, so a new treasurer
 * starts as one. Matching is on the VERIFIED email address at first sign-in.
 *
 * STATUS IS DERIVED from three facts, never stored:
 *   revoked_at IS NOT NULL   -> revoked
 *   accepted_at IS NOT NULL  -> accepted
 *   expires_at < now()       -> expired
 *   otherwise                -> pending
 * A stored status column would be a fourth fact and the only one capable of
 * being wrong.
 */
export const invites = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // NO UNIQUENESS ON email, deliberately. A partial unique index cannot include
  // `expires_at > now()` in its predicate — now() is not immutable and index
  // predicates must be — so "live" would have meant "not accepted, not revoked",
  // EXPIRED ROWS INCLUDED, and re-inviting anyone whose invite had lapsed would
  // fail on the constraint until someone manually revoked the stale row.
  //
  // That is not hypothetical: the previous schema shipped exactly that index,
  // which is why seed.ts had to revoke stale invites before inserting.
  // Duplicate live invites are harmless — authenticate.ts takes the newest with
  // ORDER BY expires_at DESC LIMIT 1 FOR UPDATE and consumes it.
  (table) => [
    index("invite_email_idx").on(table.email),
    check("invite_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
    check("invite_role_check", sql`${table.role} IN (${sqlEnumValues(roleSchema.options)})`),
    check(
      "invite_not_both_accepted_and_revoked_check",
      sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
  ],
);
