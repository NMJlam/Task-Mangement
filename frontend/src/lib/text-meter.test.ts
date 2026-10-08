import { describe, expect, it } from "vitest";
import { meterCells } from "./text-meter";

describe("meterCells", () => {
  it("fills the share of cells the value is of max", () => {
    expect(meterCells(5, 10, 10)).toEqual({ filled: 5, empty: 5 });
    expect(meterCells(62, 100, 10)).toEqual({ filled: 6, empty: 4 });
  });

  it("draws nothing for zero, a negative value, or a max of zero", () => {
    expect(meterCells(0, 10, 10)).toEqual({ filled: 0, empty: 10 });
    expect(meterCells(-3, 10, 10)).toEqual({ filled: 0, empty: 10 });
    expect(meterCells(4, 0, 10)).toEqual({ filled: 0, empty: 10 });
  });

  it("fills every cell at or over max — over budget is a full bar, not an overflow", () => {
    expect(meterCells(10, 10, 10)).toEqual({ filled: 10, empty: 0 });
    expect(meterCells(14, 10, 10)).toEqual({ filled: 10, empty: 0 });
  });

  it("never rounds a non-zero value down to an empty bar, or a short one up to a full one", () => {
    expect(meterCells(1, 100, 10)).toEqual({ filled: 1, empty: 9 });
    expect(meterCells(99, 100, 10)).toEqual({ filled: 9, empty: 1 });
  });
});
