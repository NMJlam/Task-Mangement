import type { MeResponse } from "@ctp/shared";
import { Router } from "express";
import { authenticate } from "../../middleware/index.js";

export const meRouter = Router();

/**
 * GET /api/me — the current authenticated user. The minimal protected route:
 * `authenticate` validates the Better Auth session cookie and populates
 * `req.user`, so if this returns 200 the whole auth loop (Google → Better Auth →
 * session cookie → backend verify) is working. Returns 401 without a valid session.
 */
meRouter.get("/me", authenticate, (req, res) => {
  // `req.user` is guaranteed present here because `authenticate` 401s otherwise.
  const body: MeResponse = { user: req.user! };
  res.status(200).json(body);
});
