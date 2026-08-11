import type { AuthUser } from "@ctp/shared";

/**
 * Augments Express's Request with the authenticated identity that
 * `authenticate` attaches after validating the Better Auth session. Optional
 * because it is absent until `authenticate` has run (and on public routes).
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
