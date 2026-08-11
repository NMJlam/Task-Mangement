import { describe, expect, it } from "vitest";
import { authUserSchema } from "./auth-user.js";

const user = {
  id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
  email: "member@example.com",
  role: "officer",
  tier: 0,
};

describe("authUserSchema", () => {
  it("accepts a membership identity", () => {
    expect(authUserSchema.safeParse(user).success).toBe(true);
  });

  it("rejects an invalid role", () => {
    expect(authUserSchema.safeParse({ ...user, role: "admin" }).success).toBe(false);
  });
});
