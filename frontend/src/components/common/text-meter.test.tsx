import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TextMeter } from "./text-meter";

/** How many cells the meter fills and leaves empty, read off its two runs. */
function cells(meter: HTMLElement) {
  const run = (kind: "on" | "off") =>
    Number(meter.querySelector(`[data-run="${kind}"]`)?.getAttribute("data-cells") ?? 0);
  return { on: run("on"), off: run("off") };
}

it("is a named progressbar whose drawing is hidden from assistive tech", () => {
  render(
    <TextMeter value={3} max={4} label="Jordan open tasks" valueText="3 open tasks" cells={8} />,
  );

  const meter = screen.getByRole("progressbar", { name: "Jordan open tasks" });
  expect(meter).toHaveAttribute("aria-valuenow", "3");
  expect(meter).toHaveAttribute("aria-valuemax", "4");
  expect(meter).toHaveAttribute("aria-valuetext", "3 open tasks");
  expect(cells(meter)).toEqual({ on: 6, off: 2 });
  for (const part of meter.children) expect(part).toHaveAttribute("aria-hidden", "true");
});

/**
 * Two runs, each as wide as its cells, rather than a box per cell: at 125% and
 * 150% display scaling a `1ch` box lands on a fractional pixel, and a row of
 * them showed hairline seams. No glyph either — Windows draws `░` from a taller
 * fallback font. The only text left is the ASCII brackets.
 */
it("draws a filled run and an empty run, each as wide as its cells", () => {
  render(<TextMeter value={1} max={4} label="Quarter" valueText="25%" cells={8} />);

  const meter = screen.getByRole("progressbar", { name: "Quarter" });
  expect(meter.textContent).toBe("[]");
  expect(meter.querySelector('[data-run="on"]')).toHaveStyle({ width: "2ch" });
  expect(meter.querySelector('[data-run="off"]')).toHaveStyle({ width: "6ch" });
});

it("draws no empty run when full, and no filled run when empty", () => {
  render(
    <>
      <TextMeter value={4} max={4} label="Full" valueText="full" cells={4} />
      <TextMeter value={0} max={4} label="Empty" valueText="empty" cells={4} />
    </>,
  );

  expect(
    screen.getByRole("progressbar", { name: "Full" }).querySelector('[data-run="off"]'),
  ).toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "Empty" }).querySelector('[data-run="on"]'),
  ).toBeNull();
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
  expect(cells(meter)).toEqual({ on: 4, off: 0 });
  expect(meter.querySelector('[data-run="on"]')).toHaveClass("text-danger");
});
