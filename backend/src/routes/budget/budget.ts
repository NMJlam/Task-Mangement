import {
  budgetAllocationParamsSchema,
  updateAllocationSchema,
  updateBudgetSchema,
  type BudgetResponse,
  type UpdateAllocation,
  type UpdateBudget,
} from "@ctp/shared";
import { eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { events } from "../../db/schema/index.js";
import { authenticate, authorise, authoriseCapability, validate } from "../../middleware/index.js";
import { allocateToEvent, BudgetExceededError } from "../events/service.js";
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

budgetRouter.put(
  "/budget/allocations/:eventId",
  authenticate,
  authoriseCapability("budget:manage"),
  validate(budgetAllocationParamsSchema, "params"),
  validate(updateAllocationSchema),
  async (req, res, next) => {
    try {
      const { allocationCents } = res.locals.validated as UpdateAllocation;
      const db = getDb();
      try {
        const found = await db.transaction(async (tx) => {
          const [event] = await tx
            .select({ id: events.id })
            .from(events)
            .where(eq(events.id, req.params.eventId!))
            .limit(1);
          if (!event) return false;
          await allocateToEvent(tx, event.id, allocationCents);
          return true;
        });
        if (!found) {
          res.status(404).json({ error: { code: "EVENT_NOT_FOUND", message: "Event not found." } });
          return;
        }
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
