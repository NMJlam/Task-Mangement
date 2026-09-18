import {
  budgetResponseSchema,
  can,
  expenseDecisionResponseSchema,
  expenseListResponseSchema,
  expenseResponseSchema,
  type BudgetSummary,
  type Expense,
  type ExpenseCategory,
} from "@ctp/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/use-me";

const categories: ExpenseCategory[] = [
  "catering",
  "venue",
  "marketing",
  "equipment",
  "transport",
  "printing",
  "other",
];

export function FinancePage() {
  const me = useMe();
  const [budget, setBudget] = useState<BudgetSummary>();
  const [expenses, setExpenses] = useState<Expense[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [budgetResponse, expenseResponse] = await Promise.all([
        fetch("/api/budget", { credentials: "include" }),
        fetch("/api/expenses", { credentials: "include" }),
      ]);
      if (!budgetResponse.ok || !expenseResponse.ok) throw new Error("Failed to load finance data");
      setBudget(budgetResponseSchema.parse(await budgetResponse.json()).budget);
      setExpenses(expenseListResponseSchema.parse(await expenseResponse.json()).expenses);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load finance data");
    }
  }, []);

  useEffect(() => void load(), [load]);

  const canManage = me.status === "ok" && can(me.user.role, "expense:approve");

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = Number(form.get("amount"));
    setBusy(true);
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: form.get("description"),
          amountCents: Math.round(amount * 100),
          category: form.get("category"),
        }),
      });
      if (!response.ok) throw new Error("Failed to log expense");
      const created = expenseResponseSchema.parse(await response.json()).expense;
      setExpenses((current) => [created, ...(current ?? [])]);
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to log expense");
    } finally {
      setBusy(false);
    }
  }

  async function decide(expense: Expense, action: "approve" | "reject" | "mark_paid") {
    const reason = action === "reject" ? window.prompt("Why is this expense rejected?") : null;
    if (action === "reject" && !reason?.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/expenses/${expense.id}/decision`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "reject" ? { action, reason } : { action }),
      });
      if (!response.ok) throw new Error("Failed to update expense");
      const result = expenseDecisionResponseSchema.parse(await response.json());
      setBudget(result.budget);
      setExpenses((current) =>
        current?.map((row) => (row.id === result.expense.id ? result.expense : row)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-bold tracking-tight">Finance</h1>
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}

      {budget ? (
        <section aria-labelledby="budget-heading" className="grid gap-3 sm:grid-cols-4">
          <h2 id="budget-heading" className="sr-only">
            Club budget
          </h2>
          <MoneyCard label="Budget" cents={budget.budgetCents} />
          <MoneyCard label="Allocated" cents={budget.allocationCents} />
          <MoneyCard label="Committed" cents={budget.committedCents} />
          <MoneyCard label="Spent" cents={budget.spentCents} />
        </section>
      ) : !error ? (
        <p className="text-muted-foreground">Loading finance data…</p>
      ) : null}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Log expense</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(event) => void createExpense(event)}
            >
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" required maxLength={500} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount (AUD)</Label>
                <Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  name="category"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </div>
              <Button className="self-end" disabled={busy}>
                Log expense
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="expenses-heading" className="grid gap-3">
        <h2 id="expenses-heading" className="text-xl font-semibold">
          Expenses
        </h2>
        {expenses?.length === 0 && <p className="text-muted-foreground">No expenses yet.</p>}
        {expenses?.map((expense) => (
          <Card key={expense.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="font-medium">{expense.description}</p>
                <p className="text-sm text-muted-foreground">
                  {money(expense.amountCents)} · {expense.category} ·{" "}
                  {expense.status.replace("_", " ")}
                </p>
              </div>
              {me.status === "ok" &&
                canManage &&
                expense.status === "pending" &&
                expense.submitter !== me.user.id && (
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      size="sm"
                      onClick={() => void decide(expense, "approve")}
                      aria-label={`Approve ${expense.description}`}
                    >
                      Approve
                    </Button>
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => void decide(expense, "reject")}
                      aria-label={`Reject ${expense.description}`}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              {canManage && expense.status === "approved" && (
                <Button
                  disabled={busy}
                  size="sm"
                  onClick={() => void decide(expense, "mark_paid")}
                  aria-label={`Mark ${expense.description} paid`}
                >
                  Mark paid
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}

function MoneyCard({ label, cents }: { label: string; cents: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{money(cents)}</p>
      </CardContent>
    </Card>
  );
}

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
