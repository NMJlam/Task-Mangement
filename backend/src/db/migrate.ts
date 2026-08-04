import "../config/load-env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Migrations always run through the pg (nodeDb) path — never the Neon HTTP
// driver — so this works against Docker Postgres and CI's service container.
const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL(_POOLED) is not set. See docs/setup.md before running db:migrate.");
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: "drizzle" });
await pool.end();

console.log("✅ migrations applied");
