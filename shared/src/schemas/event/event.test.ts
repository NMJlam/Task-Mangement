import { describe, expect, it } from "vitest";
import { eventStatusSchema } from "./event.js";

describe("event schemas", () => {
  it("accepts known statuses", () => {
    expect(eventStatusSchema.safeParse("cancelled").success).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(eventStatusSchema.safeParse("deleted").success).toBe(false);
  });
});
