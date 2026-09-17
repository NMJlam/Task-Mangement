import { Router } from "express";
import { cronRouter } from "./cron/cron.js";
import { eventsRouter } from "./events/events.js";
import { exampleRouter } from "./example/example.js";
import { healthRouter } from "./health/health.js";
import { invitesRouter } from "./invites/invites.js";
import { meRouter } from "./me/me.js";
import { membersRouter } from "./members/members.js";
import { notificationsRouter } from "./notifications/notifications.js";
import { tasksRouter } from "./tasks/tasks.js";
import { teamsRouter } from "./teams/teams.js";

/**
 * All routes, mounted under /api by app.ts.
 *
 * One folder per feature under routes/ (see routes/example/): each holds its
 * router (`<feature>.ts`) and its colocated tests. Register the router here.
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(meRouter);
apiRouter.use(membersRouter);
apiRouter.use(teamsRouter);
apiRouter.use(invitesRouter);
apiRouter.use(tasksRouter);
apiRouter.use(eventsRouter);
apiRouter.use(notificationsRouter);
// Mounted under a path prefix so the cron-secret guard is scoped to /api/cron/*.
apiRouter.use("/cron", cronRouter);
apiRouter.use(exampleRouter);
