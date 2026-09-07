import { describe, expect, it } from "vitest";
import { expenseCategorySchema, expenseStatusSchema } from "./expense.js";

describe("expense schemas", () => {
  it("accepts known statuses and categories", () => {
    expect(expenseStatusSchema.safeParse("approved").success).toBe(true);
    expect(expenseCategorySchema.safeParse("catering").success).toBe(true);
  });

  it("rejects unknown statuses and categories", () => {
    expect(expenseStatusSchema.safeParse("refunded").success).toBe(false);
    expect(expenseCategorySchema.safeParse("Food").success).toBe(false);
  });
});
