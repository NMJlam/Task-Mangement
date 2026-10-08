import { describe, expect, it } from "vitest";
import { ExpenseTransitionError, expenseTransition } from "./service.js";

describe("expenseTransition", () => {
  const now = new Date("2026-09-18T00:00:00Z");

  it("implements pending approval and approved settlement", () => {
    expect(
      expenseTransition("pending", { action: "approve" }, "decider", "submitter", now),
    ).toEqual({
      status: "approved",
      decider: "decider",
      decidedAt: now,
      rejectionReason: null,
    });
    expect(expenseTransition("approved", { action: "mark_paid" }, "payer", null, now)).toEqual({
      status: "paid",
      paidAt: now,
    });
  });

  it("rejects self-approval and transitions from the wrong status", () => {
    expect(() => expenseTransition("pending", { action: "approve" }, "same", "same", now)).toThrow(
      ExpenseTransitionError,
    );
    expect(() =>
      expenseTransition("rejected", { action: "mark_paid" }, "payer", "submitter", now),
    ).toThrow(ExpenseTransitionError);
  });

  it("returns a paid expense to approved and clears paidAt", () => {
    // paidAt must clear with the status: expense_paid_at_matches_status_check
    // ties the two together, so leaving it set would be refused by the database.
    expect(expenseTransition("paid", { action: "unmark_paid" }, "payer", null, now)).toEqual({
      status: "approved",
      paidAt: null,
    });
  });

  it("only unmarks an expense that is actually paid", () => {
    for (const status of ["pending", "approved", "rejected"] as const) {
      expect(() =>
        expenseTransition(status, { action: "unmark_paid" }, "payer", "submitter", now),
      ).toThrow(ExpenseTransitionError);
    }
  });
});
