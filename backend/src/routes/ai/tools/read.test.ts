import { describe, expect, it } from "vitest";
import { countOpenTasksByAssignee, PLAN_CORPUS_EVENTS } from "./read.js";

/**
 * `listMembers`'s open-task count is new server-side code, not a reuse — no
 * backend route computes per-member open-task counts today, the dashboard's
 * Committee Load widget derives it client-side. This is the pure half of that
 * rule (the SQL wiring is exercised by integration tests elsewhere), so it is
 * unit-tested here with no database, the same split `computeProgress` in
 * `routes/events/service.ts` uses.
 */
describe("countOpenTasksByAssignee", () => {
  it("counts every not-done task for a member", () => {
    const counts = countOpenTasksByAssignee([
      { userId: "m1", status: "todo" },
      { userId: "m1", status: "in_progress" },
      { userId: "m1", status: "done" },
    ]);
    expect(counts.get("m1")).toBe(2);
  });

  it("counts a multi-assignee task once for each holder", () => {
    const counts = countOpenTasksByAssignee([
      { userId: "m1", status: "todo" },
      { userId: "m2", status: "todo" },
    ]);
    expect(counts.get("m1")).toBe(1);
    expect(counts.get("m2")).toBe(1);
  });

  it("never counts a done task", () => {
    const counts = countOpenTasksByAssignee([{ userId: "m1", status: "done" }]);
    expect(counts.has("m1")).toBe(false);
  });

  it("returns an empty map for a member with no assignments", () => {
    expect(countOpenTasksByAssignee([]).size).toBe(0);
  });
});

describe("PLAN_CORPUS_EVENTS", () => {
  it("is a small, positive, prompt-sized bound", () => {
    expect(PLAN_CORPUS_EVENTS).toBeGreaterThan(0);
    expect(PLAN_CORPUS_EVENTS).toBeLessThanOrEqual(10);
  });
});
