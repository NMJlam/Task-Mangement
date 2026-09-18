import {
  can,
  listExpensesQuerySchema,
  type ExpenseListResponse,
  type ListExpensesQuery,
} from "@ctp/shared";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { expenses } from "../../db/schema/index.js";
import { authenticate, authorise, validate } from "../../middleware/index.js";

export const expensesRouter = Router();

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
