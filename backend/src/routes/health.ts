import type { HealthResponse } from "@ctp/shared";
import { Router } from "express";
import { COMMIT_SHA } from "../env.js";

export const healthRouter = Router();

// GET /api/health — the one fully-working route. Response shape is validated by
// the shared schema at the type level (HealthResponse).
healthRouter.get("/health", (_req, res) => {
  const body: HealthResponse = { ok: true, commit: COMMIT_SHA };
  res.status(200).json(body);
});
