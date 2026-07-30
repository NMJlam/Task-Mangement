import "../config/load-env.js";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

/**
 * Two connection paths, per §4.1. Keep them separate and clearly named so a
 * route can never accidentally import the migration client (or vice versa).
 */

function requireUrl(name: "DATABASE_URL"): string {
  const url = process.env[name];
  if (!url) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in — see docs/local-setup.md.`,
    );
  }
  return url;
}

function isLocalUrl(url: string): boolean {
  return /(?:localhost|127\.0\.0\.1|::1|@postgres[:/])/.test(url);
}

/**
 * Request-path driver: Neon's serverless HTTP driver. This is the path that
 * actually ships to Vercel, and the one RR9's connection-pool mitigation rests
 * on (HTTP has no long-lived pool to exhaust under serverless fan-out).
 *
 * It CANNOT talk to a local Postgres — it speaks Neon's HTTP endpoint only — so
 * we fail loudly and actionably if handed a localhost URL, rather than dying
 * obscurely at first query. A teammate will hit this in week one.
 */
export function httpDb() {
  const url = requireUrl("DATABASE_URL");
  if (isLocalUrl(url)) {
    throw new Error(
      "httpDb() was given a local DATABASE_URL. The Neon HTTP driver cannot " +
        "talk to Docker Postgres. Point DATABASE_URL at a Neon dev branch for " +
        "request-path / RR9 work, or use nodeDb() for local dev, migrations, " +
        "seeding and tests. See docs/local-setup.md.",
    );
  }
  return drizzleHttp(neon(url), { schema });
}

/**
 * Migrations, seeding, local dev, and unit/integration tests. A standard `pg`
 * pool against the pooled/local connection string. This is the DEFAULT for
 * local work and points at Docker Postgres.
 */
export function nodeDb() {
  const url = process.env.DATABASE_URL_POOLED || requireUrl("DATABASE_URL");
  const pool = new Pool({ connectionString: url });
  return drizzleNode(pool, { schema });
}
