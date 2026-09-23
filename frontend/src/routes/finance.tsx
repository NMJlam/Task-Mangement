import { can, type BudgetSummary, type Expense, type ExpenseCategory } from "@ctp/shared";
import {
  ArrowDownToLine,
  CircleDollarSign,
  Landmark,
  PiggyBank,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFinance } from "@/hooks/use-finance";
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
  const finance = useFinance();
  const canManage = me.status === "ok" && can(me.user.role, "expense:approve");
  const summary = finance.budget.status === "ok" ? finance.budget.summary : undefined;

  function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void finance
      .createExpense({
        description: String(form.get("description") ?? ""),
        amountCents: Math.round(Number(form.get("amount")) * 100),
        category: String(form.get("category")) as ExpenseCategory,
      })
      .then((created) => {
        if (created) formElement.reset();
      });
  }

  function decide(expense: Expense, action: "approve" | "reject" | "mark_paid") {
    // TODO(R8): a shadcn dialog belongs here — `window.prompt` is unstyled,
    // blockable, and outside the keyboard/ARIA guarantees the rest of the app
    // gets from Radix. Left as-is deliberately: replacing it is its own change.
    const reason = action === "reject" ? window.prompt("Why is this expense rejected?") : undefined;
    if (action === "reject" && !reason?.trim()) return;
    void finance.decide(expense, action, reason ?? undefined);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Finance"
        description="Track the club budget, review expense claims, and keep every payment accounted for."
      />

      {finance.mutationError && (
        <p className="mt-6 text-sm text-destructive" role="alert">
          {finance.mutationError}. Try again.
        </p>
      )}
      {finance.budget.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load the budget: {finance.budget.message}. Refresh the page to try again.
        </p>
      )}
      {finance.budget.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Finance Data…
        </p>
      )}

      {summary && (
        <>
          <section
            aria-labelledby="budget-heading"
            className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          >
            <div className="flex items-center justify-between gap-3 sm:col-span-2 xl:col-span-5">
              <h2 id="budget-heading" className="text-xl font-semibold tracking-tight">
                Club budget
              </h2>
              {/* The server computes this from every event's burn rate; it used
                  to be parsed and discarded. */}
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                Overall
                <StatusBadge status={summary.risk} />
              </span>
            </div>
            <MoneyCard icon={Landmark} label="Budget" cents={summary.budgetCents} />
            <MoneyCard icon={WalletCards} label="Allocated" cents={summary.allocationCents} />
            {/* budget − allocated: what is left to hand to the next event. */}
            <MoneyCard icon={PiggyBank} label="Available" cents={summary.availableCents} />
            <MoneyCard icon={ReceiptText} label="Committed" cents={summary.committedCents} />
            <MoneyCard icon={ArrowDownToLine} label="Spent" cents={summary.spentCents} />
          </section>

          {summary.allocations.length > 0 && (
            <section aria-labelledby="allocations-heading" className="mt-10">
              <h2 id="allocations-heading" className="text-xl font-semibold tracking-tight">
                Allocation by event
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                How much of the pool each event holds, and how much of that it has used.
              </p>
              <div className="mt-4 overflow-x-auto rounded-xl border bg-card">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Budget allocation, commitment and spend for each event
                  </caption>
                  <thead className="border-b text-left text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Event
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Allocated
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Committed
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Spent
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Used
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.allocations.map((row) => (
                      <AllocationRow key={row.eventId} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {summary.byCategory.length > 0 && (
            <section aria-labelledby="category-heading" className="mt-10">
              <h2 id="category-heading" className="text-xl font-semibold tracking-tight">
                Spend by category
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Approved and paid claims only — a pending claim is not yet money the club owes.
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.byCategory.map((row) => (
                  <li key={row.category} className="rounded-xl border bg-card p-4">
                    <p className="text-sm capitalize">{row.category}</p>
                    <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                      {money(row.committedCents)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {money(row.spentCents)} paid
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {canManage && (
        <Card className="mt-10 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CircleDollarSign aria-hidden="true" className="size-5 text-muted-foreground" />
              Log Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-3" onSubmit={createExpense}>
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
              <Button className="self-end" disabled={finance.busy}>
                {finance.busy ? "Saving…" : "Log Expense"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="expenses-heading" className="mt-10 grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="expenses-heading" className="text-xl font-semibold tracking-tight">
            Expenses
          </h2>
          {/* The ledger is paged. Saying how much of it is on screen is the
              difference between "that is all of them" and "that is the first
              twenty-five". */}
          {finance.expenses.status === "ok" && finance.expenses.total > 0 && (
            <p className="text-sm text-muted-foreground tabular-nums" role="status">
              Showing {finance.expenses.items.length} of {finance.expenses.total}
            </p>
          )}
        </div>

        {finance.expenses.status === "loading" && (
          <p className="text-sm text-muted-foreground" role="status">
            Loading Expenses…
          </p>
        )}
        {finance.expenses.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            Couldn&apos;t load expenses: {finance.expenses.message}. Refresh the page to try again.
          </p>
        )}
        {finance.expenses.status === "ok" && finance.expenses.items.length === 0 && (
          <Card className="border-dashed shadow-none">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No expenses have been logged yet.
            </CardContent>
          </Card>
        )}
        {finance.expenses.status === "ok" &&
          finance.expenses.items.map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              canManage={canManage}
              myId={me.status === "ok" ? me.user.id : undefined}
              busy={finance.busy}
              onDecide={decide}
            />
          ))}

        {finance.expenses.status === "ok" && finance.expenses.loaded < finance.expenses.total && (
          <div className="mt-2 flex justify-center">
            <Button
              variant="outline"
              disabled={finance.loadingMore}
              onClick={() => void finance.loadMore()}
            >
              {finance.loadingMore ? "Loading…" : "Load More"}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

function AllocationRow({ row }: { row: BudgetSummary["allocations"][number] }) {
  // `Used` is committed against allocation — the same ratio the server turns
  // into an event's risk badge, shown here as the number behind it.
  const used = row.allocationCents === 0 ? null : row.committedCents / row.allocationCents;

  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        <Link to={`/events/${row.eventId}`} className="underline-offset-4 hover:underline">
          {row.eventTitle}
        </Link>
      </th>
      <td className="px-4 py-3 text-right tabular-nums">{money(row.allocationCents)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{money(row.committedCents)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{money(row.spentCents)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {used === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          // Over-allocation is the condition that makes an event critical, so it
          // carries a word as well as the colour.
          <span className={used > 1 ? "font-medium text-destructive" : undefined}>
            {Math.round(used * 100)}%{used > 1 && <span className="sr-only"> — over budget</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

function ExpenseRow({
  expense,
  canManage,
  myId,
  busy,
  onDecide,
}: {
  expense: Expense;
  canManage: boolean;
  myId: string | undefined;
  busy: boolean;
  onDecide: (expense: Expense, action: "approve" | "reject" | "mark_paid") => void;
}) {
  // Separation of duty: the database refuses a decider who is the submitter
  // (`expense_decider_is_not_submitter_check`), so the buttons match that rule
  // rather than offering an action the server will reject.
  const mine = myId !== undefined && expense.submitter === myId;

  return (
    <Card className="gap-0 py-0 shadow-none">
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
        {canManage && expense.status === "pending" && !mine && (
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={busy}
              size="sm"
              onClick={() => onDecide(expense, "approve")}
              aria-label={`Approve ${expense.description}`}
            >
              Approve
            </Button>
            <Button
              disabled={busy}
              size="sm"
              variant="outline"
              onClick={() => onDecide(expense, "reject")}
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
            onClick={() => onDecide(expense, "mark_paid")}
            aria-label={`Mark ${expense.description} paid`}
          >
            Mark Paid
          </Button>
        )}
      </CardContent>
    </Card>
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
