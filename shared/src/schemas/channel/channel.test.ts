import { describe, expect, it } from "vitest";
import { channelKindSchema } from "./channel.js";

describe("channel schemas", () => {
  it("accepts known kinds", () => {
    expect(channelKindSchema.safeParse("dm").success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    expect(channelKindSchema.safeParse("thread").success).toBe(false);
  });
});
