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
      `${name} is not set. Copy .env.example to .env and fill it in — see docs/setup.md.`,
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
        "seeding and tests. See docs/setup.md.",
    );
  }
  return drizzleHttp(neon(url), { schema });
}

/**
 * Driver selector: returns nodeDb() for a local Postgres URL and httpDb() for a
 * Neon URL (same isLocalUrl() heuristic the httpDb() guard uses). Routes should
 * call THIS rather than picking a driver by hand, so the same handler runs
 * against Docker Postgres in local dev / tests and against Neon in production —
 * one code path, and the "never import the wrong driver" rule (§4.1) is enforced
 * in one place. See docs/architecture.md.
 */
export function getDb(): ReturnType<typeof nodeDb> {
  const url = process.env.DATABASE_URL_POOLED || requireUrl("DATABASE_URL");
  // Both drivers implement the same drizzle query builder, so routes are typed
  // against the node driver (the local/test path) for one concrete DB type; the
  // Neon HTTP driver is swapped in at runtime in production and is structurally
  // compatible for query building.
  return (isLocalUrl(url) ? nodeDb() : httpDb()) as unknown as ReturnType<typeof nodeDb>;
}

/**
 * Migrations, seeding, local dev, and unit/integration tests. A standard `pg`
 * pool against the pooled/local connection string. This is the DEFAULT for
 * local work and points at Docker Postgres.
 *
 * The pool is created ONCE and cached for the process lifecycle, then reused by
 * every caller — so getDb() on each /example/audit request shares one pool
 * instead of opening fresh connections per call. Release it with closeNodeDb()
 * on shutdown or in test teardown.
 */
let nodePool: Pool | undefined;
let cachedNodeDb: ReturnType<typeof buildNodeDb> | undefined;

function buildNodeDb() {
  const url = process.env.DATABASE_URL_POOLED || requireUrl("DATABASE_URL");
  nodePool = new Pool({ connectionString: url });
  return drizzleNode(nodePool, { schema });
}

export function nodeDb(): ReturnType<typeof buildNodeDb> {
  cachedNodeDb ??= buildNodeDb();
  return cachedNodeDb;
}

/**
 * Close the cached node pool and release its connections. A no-op if nodeDb()
 * was never called. Use it in test teardown (afterAll) and on graceful
 * shutdown so the process isn't left holding open Postgres connections.
 */
export async function closeNodeDb(): Promise<void> {
  if (nodePool) {
    await nodePool.end();
    nodePool = undefined;
    cachedNodeDb = undefined;
  }
}
