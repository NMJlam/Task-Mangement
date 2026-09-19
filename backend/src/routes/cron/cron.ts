import { and, isNull, lt, ne } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { tasks } from "../../db/schema/index.js";
import { CRON_SECRET } from "../../env.js";

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

/**
 * The nightly sweep (R10): an open task past its deadline becomes `urgent`, and
 * `overdue_escalated_at` records that it did.
 *
 * One set-based statement, not a per-task loop: the pool is a serverless
 * connection, so N round trips for N overdue tasks is the one shape that turns a
 * quiet night into a timeout.
 *
 * The marker is what makes this fire once per overdue cycle rather than every
 * night. It is cleared in exactly two places (`PATCH /tasks/:id` when the
 * deadline moves, and both status endpoints when a completed task is reopened),
 * so a user's post-escalation priority change is not overwritten tonight — only
 * a new deadline or a reopen starts the next cycle.
 *
 * `due_at < now()` excludes NULL deadlines on its own (`NULL < x` is NULL, not
 * true), which is what keeps undated work out of the sweep.
 */
cronRouter.get("/reminders", async (_req, res, next) => {
  try {
    const now = new Date();
    const escalated = await getDb()
      .update(tasks)
      .set({ priority: "urgent", overdueEscalatedAt: now, updatedAt: now })
      .where(and(lt(tasks.dueAt, now), ne(tasks.status, "done"), isNull(tasks.overdueEscalatedAt)))
      .returning({ id: tasks.id });

    // `sent` stays in the body for the notification fan-out that does not exist
    // yet; escalation is the whole of the scheduled work today.
    res.status(200).json({ ok: true, escalated: escalated.length, sent: 0 });
  } catch (error) {
    next(error);
  }
});
