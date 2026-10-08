import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TextMeter } from "./text-meter";

/**
 * Two runs, each as wide as its cells, rather than a box per cell: at 125% and
 * 150% display scaling a `1ch` box lands on a fractional pixel, and a row of
 * them showed hairline seams. No glyph either — Windows draws `░` from a taller
 * fallback font. The only text left is the ASCII brackets.
 */
it("is a named progressbar, drawn as two runs as wide as their cells and hidden from assistive tech", () => {
  render(
    <TextMeter value={3} max={4} label="Jordan open tasks" valueText="3 open tasks" cells={8} />,
  );

  const meter = screen.getByRole("progressbar", { name: "Jordan open tasks" });
  expect(meter).toHaveAttribute("aria-valuenow", "3");
  expect(meter).toHaveAttribute("aria-valuemax", "4");
  expect(meter).toHaveAttribute("aria-valuetext", "3 open tasks");
  expect(meter.textContent).toBe("[]");
  expect(meter.querySelector('[data-run="on"]')).toHaveStyle({ width: "6ch" });
  expect(meter.querySelector('[data-run="off"]')).toHaveStyle({ width: "2ch" });
  for (const part of meter.children) expect(part).toHaveAttribute("aria-hidden", "true");
});

it("draws an over-max meter full in danger with its value clamped, and an empty one with no fill", () => {
  render(
    <>
      <TextMeter
        value={112}
        max={100}
        label="Budget used"
        valueText="112% used, over budget"
        tone="danger"
        cells={4}
      />
      <TextMeter value={0} max={4} label="Empty" valueText="empty" cells={4} />
    </>,
  );

  const over = screen.getByRole("progressbar", { name: "Budget used" });
  expect(over).toHaveAttribute("aria-valuenow", "100");
  expect(over.querySelector('[data-run="on"]')).toHaveClass("text-danger");
  expect(over.querySelector('[data-run="on"]')).toHaveAttribute("data-cells", "4");
  expect(over.querySelector('[data-run="off"]')).toBeNull();
  expect(
    screen.getByRole("progressbar", { name: "Empty" }).querySelector('[data-run="on"]'),
  ).toBeNull();
});
