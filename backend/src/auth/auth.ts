import { betterAuth } from "better-auth";
import { Pool } from "pg";
import {
  BETTER_AUTH_SECRET,
  BETTER_AUTH_URL,
  DATABASE_URL,
  DEV_PASSWORD_AUTH,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from "../env.js";

/**
 * Self-hosted Better Auth instance — the auth server runs in-process, so the
 * session cookie is first-party to our own origin (works in every browser, no
 * cross-site/partitioned-cookie problem the managed service had).
 *
 * Google is the only sign-in method. Better Auth owns its own tables
 * (user/session/account/verification) in the SAME Postgres the app uses — Docker
 * locally, Neon in prod. `db:migrate` runs Better Auth's migration API before
 * Drizzle adds application tables and cross-schema foreign keys.
 *
 * TODO(R2): on Vercel serverless against Neon, swap this `pg.Pool` for the
 * Neon serverless driver so we don't hold long-lived pooled connections (RR9).
 */
export const authDatabase = new Pool({
  connectionString: DATABASE_URL,
  options: "-c search_path=auth",
});

// Idle-client errors emit on the pool; without a listener the 'error' event is
// unhandled and crashes the process. Log and let pg discard the dead client.
authDatabase.on("error", (err) => console.error("auth pool error", err));

export const auth = betterAuth({
  database: authDatabase,
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  // The browser reaches these routes at BETTER_AUTH_URL/api/auth/* (via the Vite
  // dev proxy in dev, same-origin in prod), so cookies are first-party.
  trustedOrigins: [BETTER_AUTH_URL],
  // Off unless DEV_PASSWORD_AUTH=1, which is set in local .env files only.
  // Google stays the sole sign-in method everywhere else.
  emailAndPassword: { enabled: DEV_PASSWORD_AUTH },
  socialProviders: {
    google: {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    },
  },
});
