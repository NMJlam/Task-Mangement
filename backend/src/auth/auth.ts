import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Pool } from "pg";
import { getDb } from "../db/client.js";
import { newId } from "../db/id.js";
import { invites } from "../db/schema/index.js";
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  DATABASE_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from "../env.js";

const liveInvite = (email: string) =>
  and(
    eq(invites.email, email.toLowerCase()),
    isNull(invites.acceptedAt),
    isNull(invites.revokedAt),
    gt(invites.expiresAt, new Date()),
  );

/**
 * Self-hosted Better Auth instance — the auth server runs in-process, so the
 * session cookie is first-party to our own origin (works in every browser, no
 * cross-site/partitioned-cookie problem the managed service had).
 *
 * Google is the only sign-in method. Better Auth owns its own tables
 * (user/session/account/verification) in the SAME Postgres the app uses — Docker
 * locally, Neon in prod. These are managed by Better Auth's own CLI, not the
 * Drizzle schema/`db:migrate`; create them with `npx @better-auth/cli migrate`.
 *
 * TODO(R2): on Vercel serverless against Neon, swap this `pg.Pool` for the
 * Neon serverless driver so we don't hold long-lived pooled connections (RR9).
 */
export const auth = betterAuth({
  database: new Pool({ connectionString: DATABASE_URL, options: "-c search_path=auth" }),
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  // The browser reaches these routes at BETTER_AUTH_URL/api/auth/* (via the Vite
  // dev proxy in dev, same-origin in prod), so cookies are first-party.
  trustedOrigins: [BETTER_AUTH_URL],
  socialProviders: {
    google: {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          if (!user.emailVerified) {
            throw new APIError("FORBIDDEN", { message: "A verified invited email is required." });
          }
          const [invite] = await getDb()
            .select({ id: invites.id })
            .from(invites)
            .where(liveInvite(user.email))
            .orderBy(desc(invites.expiresAt))
            .limit(1);
          if (!invite) throw new APIError("FORBIDDEN", { message: "A live invite is required." });
        },
        async after(user) {
          const result = await getDb().execute<{ membershipId: string | null }>(sql`
            WITH accepted AS (
              UPDATE ${invites}
              SET ${invites.acceptedAt} = now()
              WHERE ${invites.id} = (
                SELECT ${invites.id}
                FROM ${invites}
                WHERE ${liveInvite(user.email)}
                ORDER BY ${invites.expiresAt} DESC
                LIMIT 1
              )
              RETURNING ${invites.role}
            ), membership AS (
              INSERT INTO app_user (id, auth_user_id, role)
              SELECT ${newId()}::uuid, ${user.id}, accepted.role FROM accepted
              ON CONFLICT (auth_user_id) DO NOTHING
              RETURNING id
            ), cleanup AS (
              DELETE FROM auth."user"
              WHERE id = ${user.id}
                AND NOT EXISTS (SELECT 1 FROM membership)
              RETURNING id
            )
            SELECT (SELECT id::text FROM membership LIMIT 1) AS "membershipId"
          `);
          if (!result.rows[0]?.membershipId) {
            throw new APIError("FORBIDDEN", { message: "The invite is no longer available." });
          }
        },
      },
    },
  },
});
