import { describe, expect, it } from "vitest";
import { auditFixtureSchema } from "./audit-fixture.js";

describe("auditFixtureSchema", () => {
  it("accepts a valid payload (entityId optional)", () => {
    const result = auditFixtureSchema.safeParse({ action: "task.updated", entityType: "task" });
    expect(result.success).toBe(true);
  });

  it("accepts an optional entityId when it is a uuid", () => {
    const result = auditFixtureSchema.safeParse({
      action: "task.updated",
      entityType: "task",
      entityId: "00000000-0000-4000-8000-000000000000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty action", () => {
    const result = auditFixtureSchema.safeParse({ action: "", entityType: "task" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid entityId", () => {
    const result = auditFixtureSchema.safeParse({
      action: "task.updated",
      entityType: "task",
      entityId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});
