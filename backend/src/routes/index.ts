import { Router } from "express";
import { cronRouter } from "./cron/cron.js";
import { exampleRouter } from "./example/example.js";
import { healthRouter } from "./health/health.js";

/**
 * All routes, mounted under /api by app.ts.
 *
 * One folder per feature under routes/ (see routes/example/): each holds its
 * router (`<feature>.ts`) and its colocated tests. Register the router here.
 */
export const apiRouter = Router();

apiRouter.use(healthRouter);
// Mounted under a path prefix so the cron-secret guard is scoped to /api/cron/*.
apiRouter.use("/cron", cronRouter);
apiRouter.use(exampleRouter);
