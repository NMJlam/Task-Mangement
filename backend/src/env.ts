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

/** Local dev port for dev-server.ts. Not used on Vercel (it imports app directly). */
export const PORT = Number(process.env.PORT ?? 3001);
