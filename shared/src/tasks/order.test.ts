import { describe, expect, it } from "vitest";
import { insertAfter } from "./order.js";

const column = ["a", "b", "c", "d"];

describe("insertAfter", () => {
  it("puts a card at the top for a null anchor", () => {
    expect(insertAfter(column, "c", null)).toEqual(["c", "a", "b", "d"]);
  });

  it("appends when the anchor is not in the column", () => {
    expect(insertAfter(column, "b", "missing")).toEqual(["a", "c", "d", "b"]);
  });

  // The reported case, both directions: the first card dropped below the last,
  // and the last card dropped above the first.
  it("moves a card below a later one and above an earlier one", () => {
    expect(insertAfter(column, "a", "d")).toEqual(["b", "c", "d", "a"]);
    expect(insertAfter(column, "d", "b")).toEqual(["a", "b", "d", "c"]);
  });

  it("moves a card already in the list without duplicating or losing it", () => {
    const next = insertAfter(column, "a", "b");
    expect(next).toEqual(["b", "a", "c", "d"]);
    expect([...next].sort()).toEqual([...column].sort());
  });

  it("leaves the column alone when the anchor is already its neighbour", () => {
    expect(insertAfter(column, "b", "a")).toEqual(column);
  });

  it("fills an empty column", () => {
    expect(insertAfter([], "a", null)).toEqual(["a"]);
    expect(insertAfter([], "a", "missing")).toEqual(["a"]);
  });
});
