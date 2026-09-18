import type { EventProgress } from "@ctp/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventRiskPanel } from "./event-risk-panel";

const progress: EventProgress = {
  percentComplete: 33,
  overdueCount: 1,
  daysUntil: 15,
  budgetBurn: 0.24,
  risk: "at_risk",
  riskReasons: ["1 overdue task"],
};

describe("EventRiskPanel", () => {
  it("renders the verdict, the headline numbers and the reasons", () => {
    render(<EventRiskPanel progress={progress} />);

    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("15 days")).toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
    expect(screen.getByText("1 overdue task")).toBeInTheDocument();
  });

  it("reads an unallocated budget as no burn rather than zero", () => {
    render(<EventRiskPanel progress={{ ...progress, budgetBurn: null }} />);

    expect(screen.getByText("Not allocated")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("says the event has passed once daysUntil is negative", () => {
    render(<EventRiskPanel progress={{ ...progress, daysUntil: -3 }} />);

    expect(screen.getByText("3 days ago")).toBeInTheDocument();
  });
});
