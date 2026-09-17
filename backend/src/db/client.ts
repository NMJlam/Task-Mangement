import "../config/load-env.js";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
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
 * Request-path driver: Neon's serverless (WebSocket) driver. This is the path
 * that ships to Vercel. It uses the Pool-based neon-serverless driver, NOT the
 * neon-HTTP driver, because the driver has to match node-postgres's semantics:
 * routes run interactive transactions (branch on a row, throw mid-tx on
 * BudgetExceededError) and read raw `db.execute().rows` — both of which the
 * neon-HTTP driver does not support (it has no interactive transactions and
 * returns rows as a bare array with no `.rows`). This is what lets getDb() hand
 * every route one concrete type. The pool is cached per process, so warm Fluid
 * Compute invocations reuse it (RR9).
 *
 * It CANNOT talk to a local Postgres — point it at Neon — so we fail loudly and
 * actionably if handed a localhost URL, rather than dying obscurely at first
 * query. A teammate will hit this in week one.
 *
 * ponytail: assumes a global WebSocket (Node 22+, the Vercel default). If a
 * runtime lacks one, set neonConfig.webSocketConstructor = ws.
 */
let neonPool: NeonPool | undefined;
let cachedNeonDb: ReturnType<typeof drizzleNeon> | undefined;

export function httpDb() {
  const url = requireUrl("DATABASE_URL");
  if (isLocalUrl(url)) {
    throw new Error(
      "httpDb() was given a local DATABASE_URL. The Neon serverless driver " +
        "cannot talk to Docker Postgres. Point DATABASE_URL at a Neon dev " +
        "branch for request-path / RR9 work, or use nodeDb() for local dev, " +
        "migrations, seeding and tests. See docs/setup.md.",
    );
  }
  neonPool ??= new NeonPool({ connectionString: url });
  cachedNeonDb ??= drizzleNeon(neonPool, { schema });
  return cachedNeonDb;
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
  // Both are Pool-based drivers with the SAME query-builder, transaction and
  // raw-execute (.rows) semantics, so routes are typed against the node driver
  // (the local/test path) for one concrete DB type; the Neon serverless driver
  // is swapped in at runtime in production and behaves identically for our use.
  return (isLocalUrl(url) ? nodeDb() : httpDb()) as ReturnType<typeof nodeDb>;
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
