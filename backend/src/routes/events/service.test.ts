import { describe, expect, it } from "vitest";
import {
  assertEventDates,
  assertNoTierEscalation,
  computeProgress,
  ValidationError,
} from "./service.js";

const zeroCounts = { todo: 0, inProgress: 0, blocked: 0, done: 0 };

describe("assertEventDates", () => {
  it("passes when endsAt equals startsAt — zero-length events are legal", () => {
    const at = new Date("2026-11-01T10:00:00Z");
    expect(() => assertEventDates({ startsAt: at, endsAt: at })).not.toThrow();
  });

  it("passes when endsAt is null", () => {
    expect(() =>
      assertEventDates({ startsAt: new Date("2026-11-01T10:00:00Z"), endsAt: null }),
    ).not.toThrow();
  });

  it("fails on a merged row carrying only a later startsAt — the PATCH case a body-only refine misses", () => {
    // Simulates PATCH { startsAt: "2027-01-01" } merged onto a stored endsAt
    // of 2026-06-01: a schema .refine on the body alone would never see the
    // stored endsAt to compare against.
    const merged = {
      startsAt: new Date("2027-01-01T00:00:00Z"),
      endsAt: new Date("2026-06-01T00:00:00Z"),
    };
    expect(() => assertEventDates(merged)).toThrow(ValidationError);
  });
});

describe("assertNoTierEscalation", () => {
  it("allows raising minTier when every assignee already meets it", () => {
    expect(() =>
      assertNoTierEscalation(1, [{ assigneeTier: 2 }, { assigneeTier: 1 }, { assigneeTier: null }]),
    ).not.toThrow();
  });

  it("refuses when an assignee would lose visibility", () => {
    expect(() => assertNoTierEscalation(1, [{ assigneeTier: 0 }])).toThrow(ValidationError);
  });
});

describe("computeProgress", () => {
  const startsAt = new Date("2026-06-15T18:00:00Z");
  const createdAt = new Date("2026-05-01T00:00:00Z");
  const now = new Date("2026-05-16T00:00:00Z"); // roughly the runway midpoint

  it("percentComplete is 0 with zero tasks, not NaN", () => {
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 0,
      committedCents: 0,
      taskCounts: zeroCounts,
      overdueCount: 0,
      now,
    });
    expect(progress.percentComplete).toBe(0);
  });

  it("budgetBurn is null when allocation is zero, not a division-by-zero NaN/Infinity", () => {
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 0,
      committedCents: 500,
      taskCounts: zeroCounts,
      overdueCount: 0,
      now,
    });
    expect(progress.budgetBurn).toBeNull();
  });

  it("is on_track with no overdue tasks and burn in line with elapsed runway", () => {
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 1000,
      committedCents: 300, // burn 0.3, roughly matching the ~0.34 elapsed fraction
      taskCounts: { todo: 2, inProgress: 1, blocked: 0, done: 3 },
      overdueCount: 0,
      now,
    });
    expect(progress.risk).toBe("on_track");
  });

  it("is at_risk when any task is overdue but the event is not imminent", () => {
    const farNow = new Date("2026-05-16T00:00:00Z"); // startsAt is ~30 days out
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 1000,
      committedCents: 100,
      taskCounts: zeroCounts,
      overdueCount: 1,
      now: farNow,
    });
    expect(progress.risk).toBe("at_risk");
  });

  it("is at_risk when burn outpaces elapsed runway by more than 0.2", () => {
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 1000,
      committedCents: 900, // burn 0.9 vs ~0.34 elapsed — well past the +0.2 margin
      taskCounts: zeroCounts,
      overdueCount: 0,
      now,
    });
    expect(progress.risk).toBe("at_risk");
  });

  it("is critical when overdue and the event is within 3 days", () => {
    const soon = new Date("2026-06-13T18:00:00Z");
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 1000,
      committedCents: 100,
      taskCounts: zeroCounts,
      overdueCount: 1,
      now: soon,
    });
    expect(progress.risk).toBe("critical");
    expect(progress.daysUntil).toBe(2);
  });

  it("is critical when spend exceeds the allocation outright", () => {
    const progress = computeProgress({
      startsAt,
      createdAt,
      allocationCents: 1000,
      committedCents: 1200,
      taskCounts: zeroCounts,
      overdueCount: 0,
      now,
    });
    expect(progress.risk).toBe("critical");
  });
});
