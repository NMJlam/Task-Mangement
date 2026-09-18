import { describe, expect, it } from "vitest";
import {
  createExpenseSchema,
  decideExpenseSchema,
  expenseCategorySchema,
  expenseListResponseSchema,
  expenseParamsSchema,
  expenseResponseSchema,
  expenseSchema,
  expenseStatusSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from "./expense.js";

const expense = {
  id: "0198e1a0-0000-7000-8000-000000000001",
  eventId: null,
  teamId: null,
  amountCents: 12_500,
  description: "Venue deposit",
  category: "venue",
  status: "pending",
  submitter: null,
  decider: null,
  receiptKey: null,
  rejectionReason: null,
  decidedAt: null,
  paidAt: null,
  createdAt: new Date(),
} as const;

describe("expense schemas", () => {
  it("accepts known statuses and categories", () => {
    expect(expenseStatusSchema.safeParse("approved").success).toBe(true);
    expect(expenseCategorySchema.safeParse("catering").success).toBe(true);
  });

  it("rejects unknown statuses and categories", () => {
    expect(expenseStatusSchema.safeParse("refunded").success).toBe(false);
    expect(expenseCategorySchema.safeParse("Food").success).toBe(false);
  });

  it("validates create, patch, and lifecycle inputs", () => {
    expect(
      createExpenseSchema.parse({
        description: "Venue deposit",
        amountCents: 12_500,
        category: "venue",
      }),
    ).toEqual({ description: "Venue deposit", amountCents: 12_500, category: "venue" });
    expect(
      createExpenseSchema.safeParse({ description: "", amountCents: 0, category: "venue" }).success,
    ).toBe(false);
    expect(updateExpenseSchema.safeParse({ amountCents: 500 }).success).toBe(true);
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
    expect(decideExpenseSchema.safeParse({ action: "reject" }).success).toBe(false);
    expect(
      decideExpenseSchema.safeParse({ action: "reject", reason: "Outside the allocation" }).success,
    ).toBe(true);
    expect(decideExpenseSchema.safeParse({ action: "mark_paid" }).success).toBe(true);
  });

  it("validates params, rows, queries, and response envelopes", () => {
    expect(expenseParamsSchema.safeParse({ id: expense.id }).success).toBe(true);
    expect(expenseParamsSchema.safeParse({ id: "bad" }).success).toBe(false);
    expect(expenseSchema.safeParse(expense).success).toBe(true);
    expect(expenseSchema.safeParse({ ...expense, amountCents: -1 }).success).toBe(false);
    expect(listExpensesQuerySchema.parse({})).toMatchObject({ limit: 25, offset: 0 });
    expect(listExpensesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(expenseResponseSchema.safeParse({ expense }).success).toBe(true);
    expect(expenseResponseSchema.safeParse({}).success).toBe(false);
    expect(expenseListResponseSchema.safeParse({ expenses: [expense], total: 1 }).success).toBe(
      true,
    );
    expect(expenseListResponseSchema.safeParse({ expenses: [], total: -1 }).success).toBe(false);
  });
});
