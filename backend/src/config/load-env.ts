import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Load the monorepo-root .env regardless of the cwd a script is launched from
// (npm workspace scripts run with cwd = backend/, but tests and tools may not).
// This file lives at backend/src/config/, so the repo root is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
if (existsSync(rootEnv)) {
  config({ path: rootEnv });
} else {
  // Fall back to default cwd lookup (e.g. on Vercel, env comes from the platform).
  config();
}
