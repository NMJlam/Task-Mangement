import "./config/load-env.js";

/**
 * Minimal env access. We intentionally do NOT validate the whole environment
 * here yet — that lands with auth/config in Increment 1 (TODO(R2)). For now we
 * only expose the handful of values the scaffold's stubs need.
 */

/** Short git SHA of the running build, surfaced by GET /api/health. */
export const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.COMMIT_SHA?.slice(0, 7) ?? "";

/** Bearer secret guarding the /api/cron/* endpoints. */
export const CRON_SECRET = process.env.CRON_SECRET ?? "";

/**
 * Self-hosted Better Auth config. The auth server runs INSIDE this Express app
 * (see auth/auth.ts), so the session cookie is first-party to our own origin —
 * no cross-site cookie problem. Neon is just the Postgres store.
 */
/** Public origin the browser uses; Better Auth derives OAuth redirect URIs from it. */
export const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:5173";
/** Signing secret for session cookies / tokens. Required. */
export const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "";
/** Google OAuth app credentials (from Google Cloud Console → your OAuth client). */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
/** Postgres URL Better Auth stores users/sessions in (Docker local, Neon prod). */
export const DATABASE_URL = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || "";

/**
 * Local-only escape hatch: enables Better Auth email+password sign-in so the
 * API can be exercised by hand without Google credentials (see
 * plan-dev-harness.md). Opt-in by exact value, so an unset or empty variable
 * leaves production with exactly one sign-in path.
 */
export const DEV_PASSWORD_AUTH = process.env.DEV_PASSWORD_AUTH === "1";

/** Local dev port for dev-server.ts. Not used on Vercel (it imports app directly). */
export const PORT = Number(process.env.PORT ?? 3001);
