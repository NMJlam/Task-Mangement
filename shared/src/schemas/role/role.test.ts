import { describe, expect, it } from "vitest";
import { roleSchema, tierSchema } from "./role.js";

describe("role schemas", () => {
  it("accepts known roles and tiers", () => {
    expect(roleSchema.safeParse("president").success).toBe(true);
    expect(tierSchema.safeParse(2).success).toBe(true);
  });

  it("rejects unknown roles and tiers", () => {
    expect(roleSchema.safeParse("admin").success).toBe(false);
    expect(tierSchema.safeParse(3).success).toBe(false);
  });
});
