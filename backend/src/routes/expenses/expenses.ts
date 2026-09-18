import {
  can,
  createExpenseSchema,
  decideExpenseSchema,
  expenseParamsSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  type CreateExpense,
  type DecideExpense,
  type ExpenseDecisionResponse,
  type ExpenseListResponse,
  type ExpenseResponse,
  type ListExpensesQuery,
  type UpdateExpense,
} from "@ctp/shared";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, expenses, notifications } from "../../db/schema/index.js";
import { authenticate, authorise, authoriseCapability, validate } from "../../middleware/index.js";
import { getBudgetSummary } from "../budget/service.js";
import {
  decideExpense,
  deletePendingExpense,
  ExpenseTransitionError,
  updatePendingExpense,
} from "./service.js";

export const expensesRouter = Router();

function sqlState(error: unknown): string | undefined {
  let cursor: unknown = error;
  while (typeof cursor === "object" && cursor !== null) {
    if ("code" in cursor && typeof cursor.code === "string") return cursor.code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

function transitionError(res: Response, error: ExpenseTransitionError): void {
  const status =
    error.code === "EXPENSE_NOT_FOUND" ? 404 : error.code === "OWN_EXPENSE" ? 422 : 409;
  res.status(status).json({ error: { code: error.code, message: error.message } });
}

function unknownReference(res: Response): void {
  res.status(422).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "eventId or teamId does not identify an existing record.",
    },
  });
}

expensesRouter.get(
  "/expenses",
  authenticate,
  authorise(0),
  validate(listExpensesQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const query = res.locals.validated as ListExpensesQuery;
      const conditions: SQL[] = [];
      if (!can(req.user!.role, "expense:approve")) {
        conditions.push(
          or(eq(expenses.submitter, req.user!.id), inArray(expenses.status, ["approved", "paid"]))!,
        );
      }
      if (query.eventId) conditions.push(eq(expenses.eventId, query.eventId));
      if (query.teamId) conditions.push(eq(expenses.teamId, query.teamId));
      if (query.status) conditions.push(eq(expenses.status, query.status));
      const scope = conditions.length > 0 ? and(...conditions) : undefined;
      const db = getDb();
      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(expenses)
          .where(scope)
          .orderBy(desc(expenses.createdAt))
          .limit(query.limit)
          .offset(query.offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(expenses)
          .where(scope),
      ]);
      res.status(200).json({
        expenses: rows,
        total: countRows[0]?.count ?? 0,
      } satisfies ExpenseListResponse);
    } catch (error) {
      next(error);
    }
  },
);

expensesRouter.post(
  "/expenses",
  authenticate,
  authoriseCapability("expense:approve"),
  validate(createExpenseSchema),
  async (req, res, next) => {
    try {
      const input = res.locals.validated as CreateExpense;
      const expense = await getDb().transaction(async (tx) => {
        const [row] = await tx
          .insert(expenses)
          .values({ id: newId(), ...input, status: "pending", submitter: req.user!.id })
          .returning();
        const recipients = await tx
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(
            and(inArray(appUsers.role, ["president", "treasurer"]), ne(appUsers.id, req.user!.id)),
          );
        if (recipients.length > 0) {
          await tx.insert(notifications).values(
            recipients.map(({ id }) => ({
              id: newId(),
              userId: id,
              kind: "expense_submitted" as const,
              body: `New expense awaiting decision: “${row!.description}”.`,
              entityType: "expense",
              entityId: row!.id,
            })),
          );
        }
        return row!;
      });
      res.status(201).json({ expense } satisfies ExpenseResponse);
    } catch (error) {
      if (sqlState(error) === "23503") return unknownReference(res);
      next(error);
    }
  },
);

expensesRouter.patch(
  "/expenses/:id",
  authenticate,
  authoriseCapability("expense:approve"),
  validate(expenseParamsSchema, "params"),
  validate(updateExpenseSchema),
  async (req, res, next) => {
    try {
      const expense = await getDb().transaction((tx) =>
        updatePendingExpense(tx, req.params.id!, res.locals.validated as UpdateExpense),
      );
      res.status(200).json({ expense } satisfies ExpenseResponse);
    } catch (error) {
      if (error instanceof ExpenseTransitionError) return transitionError(res, error);
      if (sqlState(error) === "23503") return unknownReference(res);
      next(error);
    }
  },
);

expensesRouter.delete(
  "/expenses/:id",
  authenticate,
  authoriseCapability("expense:approve"),
  validate(expenseParamsSchema, "params"),
  async (req, res, next) => {
    try {
      await getDb().transaction((tx) => deletePendingExpense(tx, req.params.id!));
      res.status(204).end();
    } catch (error) {
      if (error instanceof ExpenseTransitionError) return transitionError(res, error);
      next(error);
    }
  },
);

expensesRouter.post(
  "/expenses/:id/decision",
  authenticate,
  authoriseCapability("expense:approve"),
  validate(expenseParamsSchema, "params"),
  validate(decideExpenseSchema),
  async (req, res, next) => {
    try {
      const db = getDb();
      const expense = await db.transaction((tx) =>
        decideExpense(tx, req.params.id!, res.locals.validated as DecideExpense, req.user!.id),
      );
      res.status(200).json({
        expense,
        budget: await getBudgetSummary(db),
      } satisfies ExpenseDecisionResponse);
    } catch (error) {
      if (error instanceof ExpenseTransitionError) return transitionError(res, error);
      next(error);
    }
  },
);
