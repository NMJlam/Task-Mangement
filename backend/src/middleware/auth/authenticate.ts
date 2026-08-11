import { fromNodeHeaders } from "better-auth/node";
import { eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../../auth/auth.js";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers } from "../../db/schema/index.js";

/**
 * Resolves the caller and attaches the current user to the request (R2).
 *
 * Self-hosted Better Auth runs in-process, so we validate the first-party
 * session cookie directly via `auth.api.getSession` — no JWT, no cross-site
 * cookie. 401s when there is no valid session.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign-in required." } });
      return;
    }
    const db = getDb();
    const findMembership = () =>
      db.select().from(appUsers).where(eq(appUsers.authUserId, session.user.id)).limit(1);
    let [membership] = await findMembership();
    if (!membership && session.user.emailVerified) {
      await db.execute(sql`
      WITH accepted AS (
        UPDATE "invite"
        SET "accepted_at" = now()
        WHERE "id" = (
          SELECT "id" FROM "invite"
          WHERE "email" = ${session.user.email.toLowerCase()}
            AND "accepted_at" IS NULL
            AND "revoked_at" IS NULL
            AND "expires_at" > now()
          ORDER BY "expires_at" DESC
          LIMIT 1
          FOR UPDATE
        )
        RETURNING "role"
      )
      INSERT INTO "app_user" ("id", "auth_user_id", "role")
      SELECT ${newId()}::uuid, ${session.user.id}, "role" FROM accepted
      ON CONFLICT ("auth_user_id") DO NOTHING
    `);
      [membership] = await findMembership();
    }
    if (!membership) {
      res
        .status(403)
        .json({ error: { code: "NO_MEMBERSHIP", message: "Club membership required." } });
      return;
    }
    req.user = {
      id: membership.id,
      email: session.user.email,
      role: membership.role,
      tier: membership.tier,
    };
    next();
  } catch (error) {
    next(error);
  }
}
