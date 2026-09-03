import { z } from "zod";

/**
 * Expense lifecycle: pending → approved → paid, or pending → rejected.
 * Every transition is a guarded update (`WHERE status = <expected>`), so a
 * double-click is idempotent without an idempotency-key table.
 */
export const expenseStatusSchema = z.enum(["pending", "approved", "paid", "rejected"]);

export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

/**
 * A closed set, not free text. Spend-by-category is a question the treasurer
 * will ask, and free text degrades it into near-duplicate strings ("Food",
 * "food", "catering") that no GROUP BY can reconcile.
 */
export const expenseCategorySchema = z.enum([
  "catering",
  "venue",
  "marketing",
  "equipment",
  "transport",
  "printing",
  "other",
]);

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;
