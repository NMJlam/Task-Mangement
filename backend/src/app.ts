import { toNodeHandler } from "better-auth/node";
import express from "express";
import { auth } from "./auth/auth.js";
import { log } from "./middleware/index.js";
import { apiRouter } from "./routes/index.js";

/**
 * The configured Express app. It does NOT call listen() — that lets the exact
 * same app be imported by api/index.ts (Vercel), by Vitest, and by
 * dev-server.ts without three divergent code paths (§5).
 *
 * Chain order per the proposal: log → authenticate → authorise → validate →
 * handler. `log` is global here; authenticate/authorise/validate are applied
 * per-route (see routes/example.ts) because not every route needs all three.
 */
const app = express();

app.use(log);

// Better Auth owns every /api/auth/* route (Google sign-in, callback, session).
// It MUST be mounted BEFORE express.json() so it can read the raw request body.
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// VERCEL PATH NORMALISATION — verify before relying on it.
// The catch-all rewrite in vercel.json ({ "source": "/api/(.*)", "destination":
// "/api" }) routes every /api/* request into this single function. Depending on
// how Vercel applies the rewrite, Express may see "/api/health" (matches local)
// or "/health" (prefix stripped). Deploy a preview, hit /api/health, and check
// the logged req.url / req.originalUrl. If the prefix is missing in prod, enable
// the normaliser below so routes resolve identically in prod and locally.
//
// app.use((req, _res, next) => {
//   if (!req.url.startsWith("/api")) req.url = `/api${req.url}`;
//   next();
// });
// ─────────────────────────────────────────────────────────────────────────────

app.use("/api", apiRouter);

export default app;
