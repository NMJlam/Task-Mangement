import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../../auth/auth.js";
import { getDb } from "../../db/client.js";
import { appUsers } from "../../db/schema/index.js";

/**
 * Resolves the caller and attaches the current user to the request (R2).
 *
 * Self-hosted Better Auth runs in-process, so we validate the first-party
 * session cookie directly via `auth.api.getSession` — no JWT, no cross-site
 * cookie. 401s when there is no valid session.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign-in required." } });
    return;
  }
  const [membership] = await getDb()
    .select()
    .from(appUsers)
    .where(eq(appUsers.authUserId, session.user.id))
    .limit(1);
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
}
