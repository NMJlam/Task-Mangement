import { type BudgetResponse } from "@ctp/shared";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { authenticate, authorise } from "../../middleware/index.js";
import { getBudgetSummary } from "./service.js";

export const budgetRouter = Router();

budgetRouter.get("/budget", authenticate, authorise(0), async (_req, res, next) => {
  try {
    res.status(200).json({ budget: await getBudgetSummary(getDb()) } satisfies BudgetResponse);
  } catch (error) {
    next(error);
  }
});
