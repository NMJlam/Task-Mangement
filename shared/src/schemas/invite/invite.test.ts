import { describe, expect, it } from "vitest";
import { createInviteSchema } from "./invite.js";

describe("createInviteSchema", () => {
  it("normalizes a valid invite email", () => {
    expect(
      createInviteSchema.parse({
        email: "MEMBER@EXAMPLE.COM",
        role: "officer",
        expiresAt: new Date(Date.now() + 60_000),
      }).email,
    ).toBe("member@example.com");
  });

  it("rejects expired invites", () => {
    expect(
      createInviteSchema.safeParse({
        email: "member@example.com",
        role: "officer",
        expiresAt: new Date(0),
      }).success,
    ).toBe(false);
  });
});
