import { defineConfig } from "vitest/config";

// Root Vitest config. Each workspace supplies its own environment (jsdom for
// frontend, node for backend + shared) via its local vitest.config.ts.
export default defineConfig({
  test: {
    projects: ["frontend", "backend", "shared"],
  },
});
