import { defineConfig } from "vitest/config";

// Root Vitest config. Each workspace supplies its own environment (jsdom for
// frontend, node for backend + shared) via its local vitest.config.ts.
export default defineConfig({
  test: {
    projects: ["frontend", "backend", "shared"],
    // The default (one worker per logical CPU, minus one) gives every worker
    // its own jsdom; on an 8 GB laptop with Docker up that swaps, and every
    // test slows down together until the long ones time out.
    maxWorkers: "50%",
  },
});
