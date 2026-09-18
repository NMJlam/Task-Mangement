import { updateBudgetSchema, type BudgetResponse, type UpdateBudget } from "@ctp/shared";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { authenticate, authorise, authoriseCapability, validate } from "../../middleware/index.js";
import { BudgetExceededError } from "../events/service.js";
import { getBudgetSummary, setBudget } from "./service.js";

export const budgetRouter = Router();

function exceeded(res: Response, error: Error): void {
  res.status(409).json({ error: { code: "BUDGET_EXCEEDED", message: error.message } });
}

budgetRouter.get("/budget", authenticate, authorise(0), async (_req, res, next) => {
  try {
    res.status(200).json({ budget: await getBudgetSummary(getDb()) } satisfies BudgetResponse);
  } catch (error) {
    next(error);
  }
});

budgetRouter.patch(
  "/budget",
  authenticate,
  authoriseCapability("budget:manage"),
  validate(updateBudgetSchema),
  async (_req, res, next) => {
    try {
      const { budgetCents } = res.locals.validated as UpdateBudget;
      const db = getDb();
      try {
        await db.transaction((tx) => setBudget(tx, budgetCents));
      } catch (error) {
        if (error instanceof BudgetExceededError) return exceeded(res, error);
        throw error;
      }
      res.status(200).json({ budget: await getBudgetSummary(db) } satisfies BudgetResponse);
    } catch (error) {
      next(error);
    }
  },
);
