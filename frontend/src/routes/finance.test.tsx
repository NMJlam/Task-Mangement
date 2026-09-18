import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("FinancePage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the budget, logs an expense, and approves pending claims", async () => {
    const expense = {
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
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ budget: budget() }))
      .mockResolvedValueOnce(response({ expenses: [expense], total: 1 }))
      .mockResolvedValueOnce(
        response(
          {
            expense: {
              ...expense,
              id: "018f3a4b-0000-7000-8000-000000000004",
              description: "Catering",
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        response({ expense: { ...expense, status: "approved" }, budget: budget() }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<FinancePage />);

    await waitFor(() => expect(screen.getByText("$100.00")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Catering" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: /log expense/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/expenses", expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: /approve printing/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/expenses/${expense.id}/decision`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

function response(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function budget() {
  return {
    budgetCents: 10_000,
    allocationCents: 5_000,
    committedCents: 1_250,
    spentCents: 0,
    availableCents: 5_000,
    risk: "on_track",
    allocations: [],
    byCategory: [],
  };
}
