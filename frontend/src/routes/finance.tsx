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
import {
  ArrowDownToLine,
  CircleDollarSign,
  Landmark,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
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
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Finance"
        description="Track the club budget, review expense claims, and keep every payment accounted for."
      />
      {error && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          {error}. Refresh the page to try again.
        </p>
      )}

      {budget ? (
        <section
          aria-labelledby="budget-heading"
          className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <h2 id="budget-heading" className="sr-only">
            Club budget
          </h2>
          <MoneyCard icon={Landmark} label="Budget" cents={budget.budgetCents} />
          <MoneyCard icon={WalletCards} label="Allocated" cents={budget.allocationCents} />
          <MoneyCard icon={ReceiptText} label="Committed" cents={budget.committedCents} />
          <MoneyCard icon={ArrowDownToLine} label="Spent" cents={budget.spentCents} />
        </section>
      ) : !error ? (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Finance Data…
        </p>
      ) : null}

      {canManage && (
        <Card className="mt-8 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CircleDollarSign aria-hidden="true" className="size-5 text-muted-foreground" />
              Log Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(event) => void createExpense(event)}
            >
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  name="description"
                  autoComplete="off"
                  placeholder="e.g. Event printing"
                  required
                  maxLength={500}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount (AUD)</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <select
                  id="category"
                  name="category"
                  className="h-9 cursor-pointer rounded-md border bg-background px-3 text-sm capitalize outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </div>
              <Button className="self-end" disabled={busy}>
                {busy ? "Saving…" : "Log Expense"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="expenses-heading" className="mt-10 grid gap-3">
        <h2 id="expenses-heading" className="text-xl font-semibold tracking-tight">
          Expenses
        </h2>
        {expenses?.length === 0 && (
          <Card className="border-dashed shadow-none">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No expenses have been logged yet.
            </CardContent>
          </Card>
        )}
        {expenses?.map((expense) => (
          <Card key={expense.id} className="gap-0 py-0 shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{expense.description}</h3>
                  <StatusBadge status={expense.status} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground capitalize">
                  {money(expense.amountCents)} · {expense.category}
                </p>
              </div>
              {me.status === "ok" &&
                canManage &&
                expense.status === "pending" &&
                expense.submitter !== me.user.id && (
                  <div className="flex shrink-0 gap-2">
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
                  Mark Paid
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}

function MoneyCard({
  icon: Icon,
  label,
  cents,
}: {
  icon: typeof Landmark;
  label: string;
  cents: number;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-start justify-between py-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{money(cents)}</p>
        </div>
        <span className="rounded-lg bg-secondary p-2 text-muted-foreground">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}
