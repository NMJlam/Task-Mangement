import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { FinancePage } from "./finance";

vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({
    status: "ok",
    user: {
      id: "018f3a4b-0000-7000-8000-000000000001",
      email: "treasurer@example.com",
      role: "treasurer",
      tier: 2,
    },
  }),
}));

const eventId = "018f3a4b-0000-7000-8000-000000000009";

describe("FinancePage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the budget, logs an expense, and approves pending claims", async () => {
    const claim = expense();
    const fetchMock = stubFetch({
      expenses: { expenses: [claim], total: 1 },
      post: [
        response({ expense: { ...claim, id: "…4", description: "Catering" } }, 201),
        response({ expense: { ...claim, status: "approved" }, budget: budget() }),
      ],
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("$100.00")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Catering" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: /log expense/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/expenses", expect.anything()));

    const approve = screen.getByRole("button", { name: /approve printing/i });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/expenses/${claim.id}/decision`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  /**
   * `risk`, `availableCents`, `allocations` and `byCategory` are all computed by
   * `getBudgetSummary` and were parsed and thrown away by this page — half of
   * what the endpoint returns had nowhere to appear.
   */
  it("renders the budget fields the endpoint returns", async () => {
    stubFetch({});

    renderPage();

    // availableCents — budget minus allocations, not derivable from the four
    // cards the page used to show. Scoped to its own card: `Allocated` happens
    // to hold the same amount, so a bare text match would pass on the wrong one.
    await waitFor(() => expect(screen.getByText("Available")).toBeInTheDocument());
    const available = screen.getByText("Available").parentElement;
    expect(within(available!).getByText("$50.00")).toBeInTheDocument();

    // risk, as the same badge an event's health strip uses
    expect(screen.getByText("At Risk")).toBeInTheDocument();

    // per-event allocations, linked back to the event
    const allocations = screen.getByRole("table", { name: /allocation/i });
    expect(within(allocations).getByRole("link", { name: "Semester Hackathon" })).toHaveAttribute(
      "href",
      `/events/${eventId}`,
    );
    // 3000 committed against a 2500 allocation reads as over budget
    expect(within(allocations).getByText(/120%/)).toBeInTheDocument();

    // byCategory — scoped, because "catering" is also an option in the Log
    // Expense category select.
    const byCategory = screen.getByRole("region", { name: /spend by category/i });
    expect(within(byCategory).getByText("catering")).toBeInTheDocument();
    expect(within(byCategory).getByText("$12.50")).toBeInTheDocument();
  });

  it("pages the ledger and says how much of it is on screen", async () => {
    const first = Array.from({ length: 25 }, (_, index) =>
      expense({ id: `018f3a4b-0000-7000-8000-0000000001${String(index).padStart(2, "0")}` }),
    );
    const fetchMock = stubFetch({
      expenses: { expenses: first, total: 30 },
      more: response({
        expenses: [expense({ id: "018f3a4b-0000-7000-8000-000000000200", description: "Venue" })],
        total: 30,
      }),
    });

    renderPage();

    await waitFor(() => expect(screen.getByText("Showing 25 of 30")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Load More" }));

    await waitFor(() => expect(screen.getByText("Showing 26 of 30")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/expenses?limit=25&offset=25", expect.anything());
  });

  it("offers no Load More when the first page is the whole ledger", async () => {
    stubFetch({ expenses: { expenses: [expense()], total: 1 } });

    renderPage();

    await waitFor(() => expect(screen.getByText("Showing 1 of 1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load More" })).not.toBeInTheDocument();
  });

  it("surfaces the server's own message when a read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/budget")) return Promise.resolve(response({ budget: budget() }));
        return Promise.resolve(
          response({ error: { code: "FORBIDDEN", message: "Treasurer access required" } }, 403),
        );
      }),
    );

    renderPage();

    // Not a hardcoded "Failed to load expenses" — the page used to discard the
    // body and show its own placeholder.
    await waitFor(() => expect(screen.getByText(/Treasurer access required/)).toBeInTheDocument());
  });
});

function renderPage() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <FinancePage />
    </MemoryRouter>,
  );
}

function stubFetch(stubs: { expenses?: unknown; more?: unknown; post?: unknown[] }) {
  const post = [...(stubs.post ?? [])];
  const fetchMock: Mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      return Promise.resolve(post.shift() ?? response({}, 500));
    }
    if (url.startsWith("/api/budget")) return Promise.resolve(response({ budget: budget() }));
    if (url.includes("offset=")) {
      return Promise.resolve(stubs.more ?? response({ expenses: [], total: 0 }));
    }
    if (url.startsWith("/api/expenses")) {
      return Promise.resolve(
        response(stubs.expenses ?? { expenses: [expense()], total: 1 }) as object,
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function response(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function expense(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "018f3a4b-0000-7000-8000-000000000002",
    eventId: null,
    teamId: null,
    amountCents: 1250,
    description: "Printing",
    category: "printing",
    status: "pending",
    submitter: "018f3a4b-0000-7000-8000-000000000003",
    decider: null,
    receiptKey: null,
    rejectionReason: null,
    decidedAt: null,
    paidAt: null,
    createdAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

function budget() {
  return {
    budgetCents: 10_000,
    allocationCents: 5_000,
    committedCents: 1_250,
    spentCents: 0,
    availableCents: 5_000,
    risk: "at_risk",
    allocations: [
      {
        eventId,
        eventTitle: "Semester Hackathon",
        allocationCents: 2_500,
        committedCents: 3_000,
        spentCents: 1_000,
      },
    ],
    byCategory: [{ category: "catering", committedCents: 1_250, spentCents: 0 }],
  };
}
