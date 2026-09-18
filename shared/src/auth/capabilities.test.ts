import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROLE_TIER, can, roleDiff, roleSchema, tierForRole } from "../index.js";

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

  it("reserves money mutations for the president and treasurer", () => {
    expect(can("president", "expense:approve")).toBe(true);
    expect(can("treasurer", "expense:approve")).toBe(true);
    expect(can("vice_president", "expense:approve")).toBe(false);
    expect(can("treasurer", "budget:manage")).toBe(true);
  });
});
