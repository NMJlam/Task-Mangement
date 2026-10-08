import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TextMeter } from "./text-meter";

it("is a named progressbar whose glyphs are hidden from assistive tech", () => {
  render(
    <TextMeter value={3} max={4} label="Jordan open tasks" valueText="3 open tasks" cells={8} />,
  );

  const meter = screen.getByRole("progressbar", { name: "Jordan open tasks" });
  expect(meter).toHaveAttribute("aria-valuenow", "3");
  expect(meter).toHaveAttribute("aria-valuemax", "4");
  expect(meter).toHaveAttribute("aria-valuetext", "3 open tasks");
  expect(meter.textContent).toBe("[██████░░]");
  for (const glyphs of meter.children) expect(glyphs).toHaveAttribute("aria-hidden", "true");
});

it("clamps the reported value to max, and draws an over-max meter full in danger", () => {
  render(
    <TextMeter
      value={112}
      max={100}
      label="Budget used"
      valueText="112% used, over budget"
      tone="danger"
      cells={4}
    />,
  );

  const meter = screen.getByRole("progressbar", { name: "Budget used" });
  expect(meter).toHaveAttribute("aria-valuenow", "100");
  expect(meter.textContent).toBe("[████]");
  expect(meter.querySelector(".text-danger")).not.toBeNull();
});
