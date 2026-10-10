import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  ROLE_TIER,
  can,
  roleDiff,
  roleSchema,
  tierForRole,
  type Capability,
} from "../index.js";

describe("role access", () => {
  it("maps every role to a valid tier", () => {
    expect(Object.keys(ROLE_TIER)).toEqual(roleSchema.options);
    expect(roleSchema.options.map(tierForRole)).toEqual([2, 2, 2, 2, 1, 0]);
  });

  it("contains only valid roles in the capability map", () => {
    for (const roles of Object.values(CAPABILITIES)) {
      expect(roles.every((role) => roleSchema.safeParse(role).success)).toBe(true);
    }
  });

  it("reports capability gains and removals between roles", () => {
    expect(can("director", "invite:create")).toBe(true);
    expect(roleDiff("director", "vice_president")).toEqual({
      gains: ["member:role-change"],
      removed: ["invite:create"],
    });
  });

  it("reports the deletion powers a promotion or demotion moves", () => {
    expect(roleDiff("director", "president")).toEqual({
      gains: [
        "member:role-change",
        "expense:approve",
        "budget:manage",
        "event:cancel",
        "group:delete-any",
        "message:delete-any",
      ],
      removed: [],
    });
    expect(roleDiff("president", "officer")).toEqual({
      gains: [],
      removed: [
        "member:role-change",
        "invite:create",
        "expense:approve",
        "budget:manage",
        "event:cancel",
        "group:delete-any",
        "message:delete-any",
      ],
    });
    expect(roleDiff("officer", "director")).toEqual({
      gains: ["invite:create"],
      removed: [],
    });
  });

  it("gives every creator group deletion, and moderation to the president alone", () => {
    const holders = (capability: Capability) =>
      roleSchema.options.filter((role) => can(role, capability));
    expect(holders("group:delete-any")).toEqual(["president"]);
    expect(holders("group:delete-created")).toEqual(roleSchema.options);
    expect(holders("message:delete-any")).toEqual(["president"]);
  });

  it("reserves money mutations for the president and treasurer", () => {
    expect(can("president", "expense:approve")).toBe(true);
    expect(can("treasurer", "expense:approve")).toBe(true);
    expect(can("vice_president", "expense:approve")).toBe(false);
    expect(can("treasurer", "budget:manage")).toBe(true);
  });
});
