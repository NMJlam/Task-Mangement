import {
  budgetResponseSchema,
  expenseDecisionResponseSchema,
  expenseListResponseSchema,
  expenseResponseSchema,
  type BudgetSummary,
  type CreateExpense,
  type Expense,
} from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidate } from "@/hooks/use-revalidate";
import { apiErrorMessage } from "@/lib/api-error";

/**
 * Sent explicitly rather than left to the schema's default so the page can say
 * "25 of 112" — unlike the task and notification feeds, this list DOES return a
 * total, so the end of it is known rather than inferred.
 */
const PAGE_SIZE = 25;

/** `listExpensesQuerySchema`'s cap on `limit`. */
const MAX_PAGE = 100;

/**
 * How often the page re-reads while it is on screen. The budget is one pool
 * several people act on at once — a payment entered, an expense approved, an
 * allocation changed from an event page — and without this a tab left open
 * showed whatever was true when it loaded until someone happened to refocus it.
 *
 * Three seconds, so a change made in one window shows in another quickly enough
 * to demonstrate. Each tick is two requests (the budget and a ledger page) per
 * visible tab, so a deployment on a tight quota can slow it with
 * `VITE_FINANCE_POLL_MS` (docs/setup.md). `useRevalidate` only fires it while
 * the tab is visible, so a forgotten background tab costs nothing.
 */
const DEFAULT_POLL_MS = 3_000;

/**
 * The poll interval a deployment asked for. Anything but a positive whole number
 * of milliseconds falls back to the default rather than polling in a tight loop
 * or never.
 */
export function financePollIntervalFrom(raw: string | undefined): number {
  const ms = Number(raw);
  return Number.isInteger(ms) && ms > 0 ? ms : DEFAULT_POLL_MS;
}

const POLL_MS = financePollIntervalFrom(import.meta.env.VITE_FINANCE_POLL_MS);

/**
 * Reads the first `rows` of the ledger, in pages the server will accept.
 * No `offset` on the first page: it is the plain read this page has always made.
 */
function ledgerRequests(rows: number): Promise<Response>[] {
  return Array.from({ length: Math.ceil(rows / MAX_PAGE) }, (_, page) => {
    const offset = page * MAX_PAGE;
    const limit = Math.min(MAX_PAGE, rows - offset);
    const query = `limit=${limit}${offset > 0 ? `&offset=${offset}` : ""}`;
    return fetch(`/api/expenses?${query}`, { credentials: "include" });
  });
}

/** Pages read a moment apart can overlap if a row was added between them. */
function uniqueById(items: Expense[]): Expense[] {
  const seen = new Set<string>();
  const unique: Expense[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

/** Everything `POST /api/expenses/:id/decision` accepts. */
export type ExpenseAction = "approve" | "reject" | "mark_paid" | "unmark_paid";

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
  // Rows currently on screen, so a refresh can re-read all of them rather than
  // collapsing a ledger someone has paged down back to its first page.
  const loadedRef = useRef(PAGE_SIZE);
  // Bumped whenever the user's own action changes what is on screen. A read
  // that started before it is older than the screen and must not land on it.
  const mutations = useRef(0);
  // The read now running, if any. A poll that finds one in flight skips its
  // tick: at a short interval, starting a new read cancels the old one before
  // its response lands, and a server slower than the interval would then never
  // get a single read onto the screen.
  const readId = useRef(0);
  const reading = useRef(false);

  useEffect(() => {
    if (expenses.status === "ok") loadedRef.current = expenses.loaded;
  }, [expenses]);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const rows = Math.max(PAGE_SIZE, loadedRef.current);
    const mutationsAtStart = mutations.current;
    const mine = ++readId.current;
    reading.current = true;
    // Anything the user did while this read was in flight has already put
    // fresher state on screen than these responses can; the next poll catches up.
    const stale = () => !active || mutations.current !== mutationsAtStart;

    void (async () => {
      try {
        await read();
      } finally {
        // A newer read may have taken over; only the latest one clears the flag.
        if (readId.current === mine) reading.current = false;
      }
    })();

    async function read() {
      const [budgetResponse, ledgerResponses] = await Promise.allSettled([
        fetch("/api/budget", { credentials: "include" }),
        Promise.all(ledgerRequests(rows)),
      ]);
      if (stale()) return;

      // Read separately rather than failing both on one rejection: a budget the
      // treasurer can still read is worth showing even if the ledger errored.
      if (budgetResponse.status === "fulfilled" && budgetResponse.value.ok) {
        const parsed = budgetResponseSchema.parse(await budgetResponse.value.json());
        if (!stale()) setBudget({ status: "ok", summary: parsed.budget });
      } else if (!stale()) {
        const message =
          budgetResponse.status === "fulfilled"
            ? await failure(budgetResponse.value, "Failed to load the budget")
            : "Failed to load the budget";
        setBudget((current) => (current.status === "ok" ? current : { status: "error", message }));
      }

      if (ledgerResponses.status === "fulfilled" && ledgerResponses.value.every((r) => r.ok)) {
        const pages = await Promise.all(
          ledgerResponses.value.map(async (r) => expenseListResponseSchema.parse(await r.json())),
        );
        if (!stale()) {
          const items = uniqueById(pages.flatMap((page) => page.expenses));
          setExpenses({ status: "ok", items, loaded: items.length, total: pages[0]!.total });
        }
      } else if (!stale()) {
        const failed =
          ledgerResponses.status === "fulfilled"
            ? ledgerResponses.value.find((r) => !r.ok)
            : undefined;
        const message = failed
          ? await failure(failed, "Failed to load expenses")
          : "Failed to load expenses";
        setExpenses((current) =>
          current.status === "ok" ? current : { status: "error", message },
        );
      }
    }

    return () => {
      active = false;
    };
  }, [generation]);

  const poll = useCallback(() => {
    if (!reading.current) reload();
  }, [reload]);

  // Someone else's approval, payment or allocation lands here without a reload:
  // on every return to the tab, and on a poll while it stays visible.
  useRevalidate(poll, { intervalMs: POLL_MS });

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
      mutations.current += 1;
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
      mutations.current += 1;
      setBusy(false);
    }
  }, []);

  const decide = useCallback(async (expense: Expense, action: ExpenseAction, reason?: string) => {
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
      mutations.current += 1;
      setBusy(false);
    }
  }, []);

  /**
   * Sets the club-wide budget (`PATCH /api/budget`, `budget:manage`). Resolves
   * to the server's message when it refuses, `undefined` when it took — not the
   * page-wide `mutationError` banner, because the refusal people will actually
   * hit (409: lower than what events already hold) belongs next to the field
   * that caused it, not at the top of the page.
   */
  const updateBudget = useCallback(async (budgetCents: number): Promise<string | undefined> => {
    setBusy(true);
    try {
      const response = await fetch("/api/budget", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budgetCents }),
      });
      if (!response.ok) return await failure(response, "Failed to update the budget");
      // The response is the whole recomputed summary (available and risk move
      // with the total), so it replaces ours rather than being patched.
      setBudget({
        status: "ok",
        summary: budgetResponseSchema.parse(await response.json()).budget,
      });
      return undefined;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Failed to update the budget";
    } finally {
      mutations.current += 1;
      setBusy(false);
    }
  }, []);

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
    updateBudget,
  };
}
