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

const descriptionSchema = z.string().trim().min(1, "Description is required").max(500);
const receiptKeySchema = z.string().trim().min(1).max(500);

export const expenseParamsSchema = z.object({ id: z.uuid() });

export const expenseSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid().nullable(),
  teamId: z.uuid().nullable(),
  amountCents: z.number().int().positive(),
  description: z.string(),
  category: expenseCategorySchema,
  status: expenseStatusSchema,
  submitter: z.uuid().nullable(),
  decider: z.uuid().nullable(),
  receiptKey: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  decidedAt: z.coerce.date().nullable(),
  paidAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type Expense = z.infer<typeof expenseSchema>;

export const createExpenseSchema = z.object({
  eventId: z.uuid().nullish(),
  teamId: z.uuid().nullish(),
  amountCents: z.number().int().positive(),
  description: descriptionSchema,
  category: expenseCategorySchema,
  receiptKey: receiptKeySchema.nullish(),
});

export type CreateExpense = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateExpense = z.infer<typeof updateExpenseSchema>;

export const decideExpenseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1).max(500) }),
  z.object({ action: z.literal("mark_paid") }),
]);

export type DecideExpense = z.infer<typeof decideExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  eventId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  status: expenseStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const expenseResponseSchema = z.object({ expense: expenseSchema });
export type ExpenseResponse = z.infer<typeof expenseResponseSchema>;

export const expenseListResponseSchema = z.object({
  expenses: z.array(expenseSchema),
  total: z.number().int().nonnegative(),
});
export type ExpenseListResponse = z.infer<typeof expenseListResponseSchema>;
