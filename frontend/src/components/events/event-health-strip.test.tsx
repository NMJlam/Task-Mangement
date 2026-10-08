import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventHealthStrip } from "./event-health-strip";

const zeroBudget = { allocationCents: 0, committedCents: 0, spentCents: 0 };
const counts = (done: number, todo: number) => ({ todo, inProgress: 0, blocked: 0, done });

describe("EventHealthStrip", () => {
  it("shows completion in words and as a meter named for the event it reports on", () => {
    render(
      <EventHealthStrip
        taskCounts={counts(3, 1)}
        overdueCount={0}
        budget={zeroBudget}
        subject="Winter Showcase"
      />,
    );

    expect(screen.getByText("75% complete")).toBeInTheDocument();
    const meter = screen.getByRole("progressbar", { name: "Winter Showcase tasks complete" });
    expect(meter).toHaveAttribute("aria-valuenow", "75");
    expect(meter).toHaveAttribute("aria-valuetext", "75% complete");
    expect(meter.querySelector('[data-run="on"]')).toHaveAttribute("data-cells", "8");
    expect(meter.querySelector('[data-run="off"]')).toHaveAttribute("data-cells", "2");
  });

  it("draws one done task in 250 as a sliver, and 249 in 250 as not yet done", () => {
    const { unmount } = render(
      <EventHealthStrip taskCounts={counts(1, 249)} overdueCount={0} budget={zeroBudget} />,
    );
    expect(screen.getByRole("progressbar").querySelector('[data-run="on"]')).toHaveAttribute(
      "data-cells",
      "1",
    );
    unmount();

    render(<EventHealthStrip taskCounts={counts(249, 1)} overdueCount={0} budget={zeroBudget} />);
    expect(screen.getByRole("progressbar").querySelector('[data-run="off"]')).toHaveAttribute(
      "data-cells",
      "1",
    );
  });

  it("shows 0% complete with zero tasks, not NaN", () => {
    render(<EventHealthStrip taskCounts={counts(0, 0)} overdueCount={0} budget={zeroBudget} />);
    expect(screen.getByText("0% complete")).toBeInTheDocument();
  });

  it("names overdue tasks only when there are some", () => {
    const { rerender } = render(
      <EventHealthStrip taskCounts={counts(0, 1)} overdueCount={2} budget={zeroBudget} />,
    );
    expect(screen.getByText("2 overdue tasks")).toBeInTheDocument();

    rerender(<EventHealthStrip taskCounts={counts(0, 1)} overdueCount={0} budget={zeroBudget} />);
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("shows budget burn only against an allocation, rather than dividing by zero", () => {
    const { rerender } = render(
      <EventHealthStrip
        taskCounts={counts(0, 1)}
        overdueCount={0}
        budget={{ allocationCents: 1000, committedCents: 500, spentCents: 0 }}
      />,
    );
    expect(screen.getByText("50% of budget committed")).toBeInTheDocument();

    rerender(<EventHealthStrip taskCounts={counts(0, 1)} overdueCount={0} budget={zeroBudget} />);
    expect(screen.queryByText(/of budget committed/)).not.toBeInTheDocument();
  });
});
