import { describe, expect, it } from "vitest";
import { roleSchema, type Role } from "../schemas/role/role.js";
import {
  canDeleteGroup,
  canDeleteMessage,
  groupDeletionAuthority,
  messageDeletionAuthority,
} from "./deletion.js";

const ME = "018f3a4b-0000-7000-8000-0000000000a1";
const OTHER = "018f3a4b-0000-7000-8000-0000000000b2";

const as = (role: Role) => ({ id: ME, role });

describe("messageDeletionAuthority", () => {
  it("lets every role delete its own message", () => {
    for (const role of roleSchema.options) {
      expect(messageDeletionAuthority(as(role), { author: ME })).toBe("author");
    }
  });

  it("lets only the president delete someone else's, as a moderator", () => {
    for (const role of roleSchema.options) {
      expect(canDeleteMessage(as(role), { author: OTHER })).toBe(role === "president");
    }
    expect(messageDeletionAuthority(as("president"), { author: OTHER })).toBe("moderator");
  });

  it("treats a former member's message as someone else's", () => {
    expect(canDeleteMessage(as("director"), { author: null })).toBe(false);
    expect(messageDeletionAuthority(as("president"), { author: null })).toBe("moderator");
  });
});

describe("groupDeletionAuthority", () => {
  const group = (overrides: Partial<Parameters<typeof canDeleteGroup>[1]> = {}) => ({
    kind: "group" as const,
    createdBy: ME,
    isMember: true,
    ...overrides,
  });

  it("matches the permission matrix for a group the caller opened and is in", () => {
    const allowed = roleSchema.options.filter((role) => canDeleteGroup(as(role), group()));
    expect(allowed).toEqual(roleSchema.options);
  });

  it("lets the president delete a group someone else opened, but not a director", () => {
    expect(groupDeletionAuthority(as("president"), group({ createdBy: OTHER }))).toBe("president");
    expect(canDeleteGroup(as("director"), group({ createdBy: OTHER }))).toBe(false);
  });

  it("leaves a legacy group with no recorded creator to the president", () => {
    expect(canDeleteGroup(as("president"), group({ createdBy: null }))).toBe(true);
    expect(canDeleteGroup(as("director"), group({ createdBy: null }))).toBe(false);
  });

  it("keeps a creator's ownership when demoted to officer", () => {
    expect(groupDeletionAuthority(as("officer"), group())).toBe("creator");
  });

  it("refuses everyone who is not a member, the president included", () => {
    for (const role of roleSchema.options) {
      expect(canDeleteGroup(as(role), group({ isMember: false }))).toBe(false);
    }
  });

  it("refuses every kind but a custom group", () => {
    for (const kind of ["dm", "team", "event", "ai"] as const) {
      expect(canDeleteGroup(as("president"), group({ kind }))).toBe(false);
    }
  });

  it("names the president's power before the creator's", () => {
    expect(groupDeletionAuthority(as("president"), group())).toBe("president");
    expect(groupDeletionAuthority(as("director"), group())).toBe("creator");
  });
});
