import { describe, expect, it } from "vitest";
import { createTeamSchema, listTeamsQuerySchema, updateTeamSchema } from "./team.js";

describe("createTeamSchema", () => {
  it("trims the name and leaves lead optional", () => {
    expect(createTeamSchema.parse({ name: "  Marketing  " })).toEqual({ name: "Marketing" });
  });

  it("rejects a blank name, matching the not-blank CHECK on the column", () => {
    expect(createTeamSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a lead that is not a uuid", () => {
    expect(createTeamSchema.safeParse({ name: "Media", lead: "president" }).success).toBe(false);
  });
});

describe("updateTeamSchema", () => {
  it("rejects an empty patch — that is a client bug, not a no-op", () => {
    expect(updateTeamSchema.safeParse({}).success).toBe(false);
  });

  it("accepts clearing the lead", () => {
    expect(updateTeamSchema.parse({ lead: null })).toEqual({ lead: null });
  });
});

describe("listTeamsQuerySchema", () => {
  it("defaults to no filter and rejects a non-uuid member", () => {
    expect(listTeamsQuerySchema.parse({})).toEqual({});
    expect(listTeamsQuerySchema.safeParse({ member: "me" }).success).toBe(false);
  });
});
