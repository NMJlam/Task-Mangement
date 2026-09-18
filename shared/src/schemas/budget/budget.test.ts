import { describe, expect, it } from "vitest";
import {
  budgetAllocationParamsSchema,
  budgetResponseSchema,
  budgetSummarySchema,
  expenseDecisionResponseSchema,
  updateAllocationSchema,
  updateBudgetSchema,
} from "./budget.js";

const summary = {
  budgetCents: 250_000,
  allocationCents: 25_000,
  committedCents: 10_000,
  spentCents: 5_000,
  availableCents: 225_000,
  risk: "on_track",
  allocations: [],
  byCategory: [],
} as const;

const expense = {
  id: "0198e1a0-0000-7000-8000-000000000001",
  eventId: null,
  teamId: null,
  amountCents: 500,
  description: "Printing",
  category: "printing",
  status: "paid",
  submitter: null,
  decider: null,
  receiptKey: null,
  rejectionReason: null,
  decidedAt: new Date(),
  paidAt: new Date(),
  createdAt: new Date(),
} as const;

describe("budget schemas", () => {
  it("accepts integer cents and rejects negative or empty updates", () => {
    expect(updateBudgetSchema.parse({ budgetCents: 250_000 })).toEqual({ budgetCents: 250_000 });
    expect(updateBudgetSchema.safeParse({ budgetCents: -1 }).success).toBe(false);
    expect(updateAllocationSchema.safeParse({}).success).toBe(false);
    expect(updateAllocationSchema.parse({ allocationCents: 25_000 })).toEqual({
      allocationCents: 25_000,
    });
  });

  it("validates params and every response shape", () => {
    expect(
      budgetAllocationParamsSchema.safeParse({
        eventId: "0198e1a0-0000-7000-8000-000000000002",
      }).success,
    ).toBe(true);
    expect(budgetAllocationParamsSchema.safeParse({ eventId: "bad" }).success).toBe(false);
    expect(budgetSummarySchema.safeParse(summary).success).toBe(true);
    expect(budgetSummarySchema.safeParse({ ...summary, availableCents: -1 }).success).toBe(false);
    expect(budgetResponseSchema.safeParse({ budget: summary }).success).toBe(true);
    expect(budgetResponseSchema.safeParse({}).success).toBe(false);
    expect(expenseDecisionResponseSchema.safeParse({ expense, budget: summary }).success).toBe(
      true,
    );
    expect(expenseDecisionResponseSchema.safeParse({ expense }).success).toBe(false);
  });
});
