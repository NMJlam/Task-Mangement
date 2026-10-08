import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TextMeter } from "./text-meter";

/** The meter's drawn cells, filled and empty. */
function cells(meter: HTMLElement) {
  return {
    on: meter.querySelectorAll('[data-cell="on"]'),
    off: meter.querySelectorAll('[data-cell="off"]'),
  };
}

it("is a named progressbar whose drawing is hidden from assistive tech", () => {
  render(
    <TextMeter value={3} max={4} label="Jordan open tasks" valueText="3 open tasks" cells={8} />,
  );

  const meter = screen.getByRole("progressbar", { name: "Jordan open tasks" });
  expect(meter).toHaveAttribute("aria-valuenow", "3");
  expect(meter).toHaveAttribute("aria-valuemax", "4");
  expect(meter).toHaveAttribute("aria-valuetext", "3 open tasks");
  expect(cells(meter).on).toHaveLength(6);
  expect(cells(meter).off).toHaveLength(2);
  for (const part of meter.children) expect(part).toHaveAttribute("aria-hidden", "true");
});

/**
 * Cells are boxes, not `█`/`░` characters: Windows draws `░` from a fallback
 * font that is taller than the monospace stack and overlaps the next row. The
 * only text left is the ASCII brackets, which every font has.
 */
it("draws its cells as boxes, so no glyph depends on the font", () => {
  render(<TextMeter value={1} max={2} label="Half" valueText="50%" cells={4} />);

  expect(screen.getByRole("progressbar", { name: "Half" }).textContent).toBe("[]");
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
  expect(cells(meter).on).toHaveLength(4);
  expect(cells(meter).off).toHaveLength(0);
  for (const cell of cells(meter).on) expect(cell).toHaveClass("text-danger");
});
