import { ROLE_TIER, roleSchema, type Role, type Tier } from "@ctp/shared";
import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUser } from "./auth.js";
import { sqlEnumValues } from "./sql-enum.js";

/**
 * The MEMBERSHIP record — one row per committee member. Better Auth owns real
 * identity in `auth.user`; this table is what makes someone a member.
 *
 * That distinction is the entire authorization boundary: anyone with a Google
 * account can complete the sign-in flow, so an auth user proves IDENTITY and
 * never MEMBERSHIP. `invite` is the gate (see `middleware/auth/authenticate.ts`).
 *
 * No `name`/`email` here — they live in `auth.user` and the roster joins for
 * them. No `oauth_sub` — `auth.account` already stores the Google subject.
 */
export const appUsers = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey(),

    // RESTRICT, not CASCADE: deleting the auth user must not silently bypass the
    // handover. Removal goes through the service in a fixed order — reassign
    // open tasks, delete this row, then delete the auth user (which cascades its
    // sessions, revoking access immediately). With CASCADE, one stray delete
    // orphans a departing member's open tasks with no handover at all.
    authUserId: text("auth_user_id")
      .notNull()
      .unique()
      .references(() => authUser.id, { onDelete: "restrict" }),

    role: text("role").$type<Role>().notNull(),

    // Tier answers "what can I see"; role answers "what can I change".
    // Adding a role to the CHECK without adding it here produces NULL, which the
    // NOT NULL rejects loudly. That is intended: you cannot half-add a position.
    tier: smallint("tier")
      .$type<Tier>()
      .notNull()
      .generatedAlwaysAs(
        sql`CASE role
          ${sql.join(
            roleSchema.options.map(
              (role) => sql`WHEN ${sql.raw(`'${role}'`)} THEN ${sql.raw(String(ROLE_TIER[role]))}`,
            ),
            sql`
          `,
          )}
        END`,
      ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // No further indexes. At twenty rows the planner sequentially scans whatever
  // you build, and the unique constraint on auth_user_id already covers the one
  // hot lookup: session user id -> member, on every request.
  (table) => [
    check("app_user_role_check", sql`${table.role} IN (${sqlEnumValues(roleSchema.options)})`),
  ],
);
