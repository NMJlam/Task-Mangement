import { z } from "zod";
import { riskSchema } from "../event/event.js";
import { expenseCategorySchema, expenseResponseSchema } from "../expense/expense.js";

export const updateBudgetSchema = z.object({
  budgetCents: z.number().int().nonnegative(),
});
export type UpdateBudget = z.infer<typeof updateBudgetSchema>;

export const budgetAllocationParamsSchema = z.object({ eventId: z.uuid() });
export const updateAllocationSchema = z.object({
  allocationCents: z.number().int().nonnegative(),
});
export type UpdateAllocation = z.infer<typeof updateAllocationSchema>;

export const budgetSummarySchema = z.object({
  budgetCents: z.number().int().nonnegative(),
  allocationCents: z.number().int().nonnegative(),
  committedCents: z.number().int().nonnegative(),
  spentCents: z.number().int().nonnegative(),
  availableCents: z.number().int().nonnegative(),
  risk: riskSchema,
  allocations: z.array(
    z.object({
      eventId: z.uuid(),
      eventTitle: z.string(),
      allocationCents: z.number().int().nonnegative(),
      committedCents: z.number().int().nonnegative(),
      spentCents: z.number().int().nonnegative(),
    }),
  ),
  byCategory: z.array(
    z.object({
      category: expenseCategorySchema,
      committedCents: z.number().int().nonnegative(),
      spentCents: z.number().int().nonnegative(),
    }),
  ),
});

export type BudgetSummary = z.infer<typeof budgetSummarySchema>;

export const budgetResponseSchema = z.object({ budget: budgetSummarySchema });
export type BudgetResponse = z.infer<typeof budgetResponseSchema>;

export const expenseDecisionResponseSchema = expenseResponseSchema.extend({
  budget: budgetSummarySchema,
});
export type ExpenseDecisionResponse = z.infer<typeof expenseDecisionResponseSchema>;
