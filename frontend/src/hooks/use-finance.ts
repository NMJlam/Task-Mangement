import {
  budgetResponseSchema,
  expenseDecisionResponseSchema,
  expenseListResponseSchema,
  expenseResponseSchema,
  type BudgetSummary,
  type CreateExpense,
  type Expense,
} from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";
import { useRevalidate } from "@/hooks/use-revalidate";
import { apiErrorMessage } from "@/lib/api-error";

/**
 * Sent explicitly rather than left to the schema's default so the page can say
 * "25 of 112" — unlike the task and notification feeds, this list DOES return a
 * total, so the end of it is known rather than inferred.
 */
const PAGE_SIZE = 25;

type BudgetState =
  | { status: "loading" }
  | { status: "ok"; summary: BudgetSummary }
  | { status: "error"; message: string };

type ExpensesState =
  | { status: "loading" }
  | {
      status: "ok";
      items: Expense[];
      /** Rows the server has handed over — not `items.length`, which a local create inflates. */
      loaded: number;
      total: number;
    }
  | { status: "error"; message: string };

/** The message a failed response deserves: the server's own, not a placeholder. */
async function failure(response: Response, fallback: string): Promise<string> {
  try {
    return apiErrorMessage(await response.json()) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * ViewModel for `/finance` (R8).
 *
 * ONE hook for both halves, because the server treats them as one aggregate: a
 * decision on an expense returns the recomputed budget in the same response
 * (`expenseDecisionResponseSchema`). Splitting this into `useBudget` and
 * `useExpenses` would mean one hook writing the other's state after every
 * approval, which is the coupling this avoids.
 *
 * It also replaces the raw `fetch`/`useState` the route carried inline, which
 * was the one page in the app bypassing the ViewModel layer (CLAUDE.md, MVVM).
 */
export function useFinance() {
  const [budget, setBudget] = useState<BudgetState>({ status: "loading" });
  const [expenses, setExpenses] = useState<ExpensesState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [budgetResponse, expenseResponse] = await Promise.allSettled([
        fetch("/api/budget", { credentials: "include" }),
        fetch(`/api/expenses?limit=${PAGE_SIZE}`, { credentials: "include" }),
      ]);
      if (!active) return;

      // Read separately rather than failing both on one rejection: a budget the
      // treasurer can still read is worth showing even if the ledger errored.
      if (budgetResponse.status === "fulfilled" && budgetResponse.value.ok) {
        const parsed = budgetResponseSchema.parse(await budgetResponse.value.json());
        if (active) setBudget({ status: "ok", summary: parsed.budget });
      } else if (active) {
        const message =
          budgetResponse.status === "fulfilled"
            ? await failure(budgetResponse.value, "Failed to load the budget")
            : "Failed to load the budget";
        setBudget((current) => (current.status === "ok" ? current : { status: "error", message }));
      }

      if (expenseResponse.status === "fulfilled" && expenseResponse.value.ok) {
        const parsed = expenseListResponseSchema.parse(await expenseResponse.value.json());
        if (active) {
          setExpenses({
            status: "ok",
            items: parsed.expenses,
            loaded: parsed.expenses.length,
            total: parsed.total,
          });
        }
      } else if (active) {
        const message =
          expenseResponse.status === "fulfilled"
            ? await failure(expenseResponse.value, "Failed to load expenses")
            : "Failed to load expenses";
        setExpenses((current) =>
          current.status === "ok" ? current : { status: "error", message },
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [generation]);

  // Someone else's approval should land here without a reload; focus only, since
  // a ledger is not a feed and a poll would be noise.
  useRevalidate(reload);

  /**
   * Appends the next page. The list caps at 25, and before this the 26th claim
   * was unreachable with nothing on screen admitting it.
   */
  const loadMore = useCallback(async () => {
    if (expenses.status !== "ok" || expenses.loaded >= expenses.total || loadingMore) return;
    setLoadingMore(true);
    setMutationError(undefined);
    try {
      const response = await fetch(`/api/expenses?limit=${PAGE_SIZE}&offset=${expenses.loaded}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await failure(response, "Failed to load more expenses"));
      const parsed = expenseListResponseSchema.parse(await response.json());
      setExpenses((current) =>
        current.status === "ok"
          ? {
              status: "ok",
              items: [
                ...current.items,
                ...parsed.expenses.filter(
                  (row) => !current.items.some((held) => held.id === row.id),
                ),
              ],
              loaded: current.loaded + parsed.expenses.length,
              total: parsed.total,
            }
          : current,
      );
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to load more expenses");
    } finally {
      setLoadingMore(false);
    }
  }, [expenses, loadingMore]);

  const createExpense = useCallback(async (input: CreateExpense) => {
    setBusy(true);
    setMutationError(undefined);
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await failure(response, "Failed to log expense"));
      const created = expenseResponseSchema.parse(await response.json()).expense;
      setExpenses((current) =>
        current.status === "ok"
          ? {
              ...current,
              items: [created, ...current.items],
              // The row exists on the server too, so the ledger is one longer —
              // but `loaded` must not move, or the next page would skip a row.
              total: current.total + 1,
            }
          : current,
      );
      return true;
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to log expense");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const decide = useCallback(
    async (expense: Expense, action: "approve" | "reject" | "mark_paid", reason?: string) => {
      setBusy(true);
      setMutationError(undefined);
      try {
        const response = await fetch(`/api/expenses/${expense.id}/decision`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action === "reject" ? { action, reason } : { action }),
        });
        if (!response.ok) throw new Error(await failure(response, "Failed to update expense"));
        const result = expenseDecisionResponseSchema.parse(await response.json());
        // The decision recomputes the whole budget (an approval moves
        // `committed`, a payment moves `spent`), so the response's summary
        // replaces ours rather than being patched.
        setBudget({ status: "ok", summary: result.budget });
        setExpenses((current) =>
          current.status === "ok"
            ? {
                ...current,
                items: current.items.map((row) =>
                  row.id === result.expense.id ? result.expense : row,
                ),
              }
            : current,
        );
        return true;
      } catch (cause) {
        setMutationError(cause instanceof Error ? cause.message : "Failed to update expense");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return {
    budget,
    expenses,
    busy,
    loadingMore,
    mutationError,
    loadMore,
    reload,
    createExpense,
    decide,
  };
}
