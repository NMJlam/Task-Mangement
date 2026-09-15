import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventHealthStrip } from "./event-health-strip";

const zeroBudget = { allocationCents: 0, committedCents: 0, spentCents: 0 };

describe("EventHealthStrip", () => {
  it("shows percent complete from taskCounts", () => {
    render(
      <EventHealthStrip
        taskCounts={{ todo: 1, inProgress: 0, blocked: 0, done: 3 }}
        overdueCount={0}
        budget={zeroBudget}
      />,
    );
    expect(screen.getByText("75% complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("shows 0% complete with zero tasks, not NaN", () => {
    render(
      <EventHealthStrip
        taskCounts={{ todo: 0, inProgress: 0, blocked: 0, done: 0 }}
        overdueCount={0}
        budget={zeroBudget}
      />,
    );
    expect(screen.getByText("0% complete")).toBeInTheDocument();
  });

  it("surfaces an overdue count when present", () => {
    render(
      <EventHealthStrip
        taskCounts={{ todo: 1, inProgress: 0, blocked: 0, done: 0 }}
        overdueCount={2}
        budget={zeroBudget}
      />,
    );
    expect(screen.getByText("2 overdue tasks")).toBeInTheDocument();
  });

  it("says nothing about overdue tasks when there are none", () => {
    render(
      <EventHealthStrip
        taskCounts={{ todo: 1, inProgress: 0, blocked: 0, done: 0 }}
        overdueCount={0}
        budget={zeroBudget}
      />,
    );
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("omits budget burn when the allocation is zero, rather than dividing by it", () => {
    render(
      <EventHealthStrip
        taskCounts={{ todo: 1, inProgress: 0, blocked: 0, done: 0 }}
        overdueCount={0}
        budget={zeroBudget}
      />,
    );
    expect(screen.queryByText(/of budget committed/)).not.toBeInTheDocument();
  });

  it("shows budget burn when an allocation exists", () => {
    render(
      <EventHealthStrip
        taskCounts={{ todo: 1, inProgress: 0, blocked: 0, done: 0 }}
        overdueCount={0}
        budget={{ allocationCents: 1000, committedCents: 500, spentCents: 0 }}
      />,
    );
    expect(screen.getByText("50% of budget committed")).toBeInTheDocument();
  });
});
