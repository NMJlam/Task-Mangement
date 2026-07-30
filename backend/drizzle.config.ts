import "./src/config/load-env.js";
import { defineConfig } from "drizzle-kit";

// Migrations/introspection use the pg (nodeDb) connection string, never the
// Neon HTTP driver. Prefer the pooled/local URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || "",
  },
});
