// Vercel discovers serverless functions only in a root-level api/ directory, so
// this shim is the single entry point that hands every /api/* request to the
// Express app. Nothing else belongs in api/ — if you add a second file here, the
// layering is wrong (§1.1).
//
// The import is RELATIVE, not the @ctp/backend workspace name: Vercel's file
// tracing follows relative paths reliably and can miss workspace-linked deps.
//
// It points at the COMPILED output (backend/dist), not src: Vercel's builder
// cannot remap a ".js" import onto ".ts" source across the workspace, so
// importing src/app.js fails at runtime with ERR_MODULE_NOT_FOUND. dist/app.js
// is a real emitted file the file tracer can resolve. `npm run build` produces
// it (see backend/tsconfig.build.json); dev/tests still run from src via tsx.
import app from "../backend/dist/app.js";

export default app;
