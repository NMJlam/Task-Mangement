import { describe, expect, it } from "vitest";
import { auditFixtureSchema } from "./audit-fixture.js";

describe("auditFixtureSchema", () => {
  const valid = { action: "task.updated", entityType: "task" };

  it("accepts a payload with or without a uuid entityId", () => {
    expect(auditFixtureSchema.safeParse(valid).success).toBe(true);
    expect(
      auditFixtureSchema.safeParse({ ...valid, entityId: "00000000-0000-4000-8000-000000000000" })
        .success,
    ).toBe(true);
  });

  it("rejects an empty action or a non-uuid entityId", () => {
    expect(auditFixtureSchema.safeParse({ ...valid, action: "" }).success).toBe(false);
    expect(auditFixtureSchema.safeParse({ ...valid, entityId: "not-a-uuid" }).success).toBe(false);
  });
});
