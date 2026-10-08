import { describe, expect, it } from "vitest";
import { channelKindSchema } from "./channel.js";

describe("channel schemas", () => {
  it("accepts known kinds and rejects unknown ones", () => {
    expect(channelKindSchema.safeParse("dm").success).toBe(true);
    expect(channelKindSchema.safeParse("thread").success).toBe(false);
  });
});
