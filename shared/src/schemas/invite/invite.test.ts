import { describe, expect, it } from "vitest";
import { createInviteSchema } from "./invite.js";

describe("createInviteSchema", () => {
  it("normalizes a valid invite email", () => {
    expect(
      createInviteSchema.parse({
        email: "MEMBER@EXAMPLE.COM",
        role: "officer",
      }).email,
    ).toBe("member@example.com");
  });
});
