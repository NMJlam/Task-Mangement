import { describe, expect, it } from "vitest";
import { changeMemberRoleSchema, memberSchema } from "./member.js";

const member = {
  id: "019ff060-2362-7399-9032-b4bbcc3a25d5",
  role: "officer",
  tier: 0,
  createdAt: new Date(),
};

describe("member schemas", () => {
  it("accepts a member and a role change, and rejects mismatched or unknown roles", () => {
    expect(memberSchema.safeParse(member).success).toBe(true);
    expect(changeMemberRoleSchema.safeParse({ role: "president" }).success).toBe(true);
    expect(memberSchema.safeParse({ ...member, tier: 4 }).success).toBe(false);
    expect(changeMemberRoleSchema.safeParse({ role: "admin" }).success).toBe(false);
  });
});
