import {
  can,
  createExpenseSchema,
  listExpensesQuerySchema,
  type CreateExpense,
  type ExpenseListResponse,
  type ExpenseResponse,
  type ListExpensesQuery,
} from "@ctp/shared";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { Router, type Response } from "express";
import { getDb } from "../../db/client.js";
import { newId } from "../../db/id.js";
import { appUsers, expenses, notifications } from "../../db/schema/index.js";
import { authenticate, authorise, authoriseCapability, validate } from "../../middleware/index.js";

export const expensesRouter = Router();

function sqlState(error: unknown): string | undefined {
  let cursor: unknown = error;
  while (typeof cursor === "object" && cursor !== null) {
    if ("code" in cursor && typeof cursor.code === "string") return cursor.code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
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
