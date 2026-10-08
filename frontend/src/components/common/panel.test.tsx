import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { Panel } from "./panel";

it("is a region named by its heading, with meta and action in the border", () => {
  render(
    <Panel title="My Tasks" meta="3 open" action={<a href="/tasks">View All</a>}>
      <p>Body</p>
    </Panel>,
  );

  const region = screen.getByRole("region", { name: "My Tasks" });
  expect(within(region).getByRole("heading", { level: 2, name: "My Tasks" })).toBeInTheDocument();
  expect(within(region).getByText("3 open")).toBeInTheDocument();
  expect(within(region).getByRole("link", { name: "View All" })).toBeInTheDocument();
  expect(within(region).getByText("Body")).toBeInTheDocument();

  // A lower level where it nests under another heading.
  render(
    <Panel title="Risk" level={3}>
      x
    </Panel>,
  );
  expect(screen.getByRole("heading", { level: 3, name: "Risk" })).toBeInTheDocument();
});

it("hides the drawn border lines from assistive tech", () => {
  const { container } = render(<Panel title="Today">x</Panel>);

  const lines = container.querySelectorAll(".panel-line");
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) expect(line).toHaveAttribute("aria-hidden", "true");
});
