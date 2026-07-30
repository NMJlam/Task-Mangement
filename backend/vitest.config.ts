import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the shared workspace from source in tests, mirroring
  // frontend/vite.config.ts. shared/package.json now points at the compiled
  // dist for the Node/Vercel runtime; tests must not depend on a build step.
  resolve: {
    alias: {
      "@ctp/shared": path.resolve(import.meta.dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    name: "backend",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
