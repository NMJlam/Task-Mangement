import { Router } from "express";
import { cronRouter } from "./cron.js";
import { exampleRouter } from "./example.js";
import { healthRouter } from "./health.js";

/** All routes, mounted under /api by app.ts. */
export const apiRouter = Router();

apiRouter.use(healthRouter);
// Mounted under a path prefix so the cron-secret guard is scoped to /api/cron/*.
apiRouter.use("/cron", cronRouter);
apiRouter.use(exampleRouter);
