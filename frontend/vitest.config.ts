import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuse the app's vite config (react plugin + aliases) so tests resolve "@/..."
// and "@ctp/shared" exactly like the app does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: "frontend",
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      // Route tests drive whole pages through modals and pickers; a few take
      // 2-3s alone, so vitest's 5s default leaves no headroom on a busy machine.
      testTimeout: 15_000,
    },
  }),
);
