import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { CRON_SECRET } from "../env.js";

export const cronRouter = Router();

/**
 * Both cron endpoints exist so the schedule can be turned on later, but only
 * the nightly reminder sweep is registered in vercel.json — the Hobby plan
 * cannot run the 5-minute warm ping (see docs/stack-versions.md, RR6). They are
 * guarded by a CRON_SECRET bearer check so they can't be hit publicly.
 */
function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  if (!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({
      error: { code: "UNAUTHORISED", message: "Missing or invalid cron secret" },
    });
    return;
  }
  next();
}

// Scoped to this router only — it is mounted under "/cron" in routes/index.ts,
// so the guard never leaks onto sibling routes.
cronRouter.use(requireCronSecret);

// TODO(RR6): warm ping to mitigate cold starts. Not scheduled on Hobby.
cronRouter.get("/warm", (_req, res) => {
  res.status(200).json({ ok: true });
});

// TODO(R10): nightly reminder sweep. Scheduled in vercel.json.
cronRouter.get("/reminders", (_req, res) => {
  res.status(200).json({ ok: true, sent: 0 });
});
