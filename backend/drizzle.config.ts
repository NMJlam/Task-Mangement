import "./src/config/load-env.js";
import { defineConfig } from "drizzle-kit";

// Migrations/introspection use the pg (nodeDb) connection string, never the
// Neon HTTP driver. Prefer the pooled/local URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./drizzle",
  // Better Auth owns the `auth` schema and creates it through its own migration
  // API (see src/db/migrate.ts, which runs it BEFORE Drizzle). We declare
  // auth."user" read-only in schema/auth.ts purely so app_user's foreign key
  // can be expressed in Drizzle instead of hand-patched into the migration SQL
  // — where it was invisible to the snapshot, and therefore to every diff.
  //
  // This filter is what stops drizzle-kit trying to CREATE or DROP anything in
  // that schema now that it can see it.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || "",
  },
});
