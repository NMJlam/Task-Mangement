import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * DB-backed integration tests (supertest → real Express app → Docker Postgres).
 * Standalone (not part of the root `projects` list) so `npm run test:unit` never
 * picks these up and can run with no database. Run via `npm run test:integration`
 * (needs Docker Postgres up + migrated/seeded). See docs/contributing.md.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@ctp/shared": path.resolve(import.meta.dirname, "../shared/src/index.ts"),
    },
  },
  // Pin root to this package so `include` resolves under backend/, not the repo
  // root (vitest defaults root to cwd when --config is passed from the root).
  root: import.meta.dirname,
  test: {
    name: "backend-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // One DB, no cross-test parallelism racing on the same tables.
    fileParallelism: false,
  },
});
