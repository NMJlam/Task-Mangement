import { describe, expect, it } from "vitest";
import { budgetRisk } from "./service.js";

describe("budgetRisk", () => {
  it("reuses event progress risk and still catches a club-wide overspend", () => {
    const event = {
      startsAt: new Date("2026-01-11T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      allocationCents: 1_000,
      committedCents: 800,
    };

    expect(budgetRisk(2_000, 800, [event], new Date("2026-01-06T00:00:00Z"))).toBe("at_risk");
    expect(budgetRisk(500, 501, [], new Date("2026-01-06T00:00:00Z"))).toBe("critical");
    expect(budgetRisk(2_000, 0, [], new Date("2026-01-06T00:00:00Z"))).toBe("on_track");
  });
});
