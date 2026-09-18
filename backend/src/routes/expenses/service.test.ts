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
});
