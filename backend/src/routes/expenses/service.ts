import type { DecideExpense, ExpenseStatus, UpdateExpense } from "@ctp/shared";
import { and, eq } from "drizzle-orm";
import { newId } from "../../db/id.js";
import { expenses, notifications } from "../../db/schema/index.js";
import type { Tx } from "../events/service.js";

type ExpensePatch = Partial<typeof expenses.$inferInsert>;

export class ExpenseTransitionError extends Error {
  constructor(
    public readonly code: "EXPENSE_NOT_FOUND" | "INVALID_EXPENSE_STATE" | "OWN_EXPENSE",
    message: string,
  ) {
    super(message);
    this.name = "ExpenseTransitionError";
  }
}

export function expenseTransition(
  status: ExpenseStatus,
  decision: DecideExpense,
  actorId: string,
  submitter: string | null,
  now = new Date(),
): ExpensePatch {
  if (decision.action === "mark_paid") {
    if (status !== "approved") {
      throw new ExpenseTransitionError(
        "INVALID_EXPENSE_STATE",
        "Only an approved expense can be marked paid.",
      );
    }
    return { status: "paid", paidAt: now };
  }

  if (status !== "pending") {
    throw new ExpenseTransitionError(
      "INVALID_EXPENSE_STATE",
      "Only a pending expense can be approved or rejected.",
    );
  }
  if (submitter === actorId) {
    throw new ExpenseTransitionError("OWN_EXPENSE", "You cannot decide your own expense.");
  }

  return decision.action === "approve"
    ? { status: "approved", decider: actorId, decidedAt: now, rejectionReason: null }
    : {
        status: "rejected",
        decider: actorId,
        decidedAt: now,
        rejectionReason: decision.reason,
      };
}

async function lockedExpense(tx: Tx, id: string) {
  const [expense] = await tx
    .select()
    .from(expenses)
    .where(eq(expenses.id, id))
    .limit(1)
    .for("update");
  if (!expense) {
    throw new ExpenseTransitionError("EXPENSE_NOT_FOUND", "Expense not found.");
  }
  return expense;
}

function requirePending(status: ExpenseStatus): void {
  if (status !== "pending") {
    throw new ExpenseTransitionError(
      "INVALID_EXPENSE_STATE",
      "Only a pending expense can be changed.",
    );
  }
}

export async function updatePendingExpense(tx: Tx, id: string, patch: UpdateExpense) {
  const current = await lockedExpense(tx, id);
  requirePending(current.status);
  const [updated] = await tx
    .update(expenses)
    .set(patch)
    .where(and(eq(expenses.id, id), eq(expenses.status, "pending")))
    .returning();
  return updated!;
}

export async function deletePendingExpense(tx: Tx, id: string): Promise<void> {
  const current = await lockedExpense(tx, id);
  requirePending(current.status);
  await tx.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.status, "pending")));
}

export async function decideExpense(tx: Tx, id: string, decision: DecideExpense, actorId: string) {
  const current = await lockedExpense(tx, id);
  const patch = expenseTransition(current.status, decision, actorId, current.submitter);
  const [updated] = await tx
    .update(expenses)
    .set(patch)
    .where(and(eq(expenses.id, id), eq(expenses.status, current.status)))
    .returning();

  if (current.submitter && current.submitter !== actorId) {
    const verb = decision.action === "mark_paid" ? "marked paid" : updated!.status;
    await tx.insert(notifications).values({
      id: newId(),
      userId: current.submitter,
      kind: "expense_decided",
      body: `Your expense “${current.description}” was ${verb}.`,
      entityType: "expense",
      entityId: id,
    });
  }

  return updated!;
}
