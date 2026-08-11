import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ESM note: this config is an ES module (package.json "type": "module"), so
// `__dirname` does not exist. `import.meta.dirname` (Node 20.11+) is the
// modern equivalent used everywhere below.
const root = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Env lives in the monorepo-root .env (shared with the backend), not frontend/.
  // Without this, Vite only reads frontend/.env and VITE_* vars come back undefined.
  envDir: path.resolve(root, ".."),
  resolve: {
    alias: {
      // shadcn + app imports: "@/..." → frontend/src/...
      "@": path.resolve(root, "./src"),
      // Resolve the shared workspace from source so dev needs no build step.
      "@ctp/shared": path.resolve(root, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    // Dev proxy: forward /api to the local backend (dev-server.ts on :3001).
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
