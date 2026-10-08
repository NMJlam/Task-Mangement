import { describe, expect, it } from "vitest";
import { auditActionSchema } from "./audit.js";

describe("auditActionSchema", () => {
  it("accepts the four event actions, and nothing else", () => {
    for (const action of [
      "event.created",
      "event.updated",
      "event.status_changed",
      "event.cancelled",
    ]) {
      expect(auditActionSchema.safeParse(action).success).toBe(true);
    }
    expect(auditActionSchema.safeParse("event.deleted").success).toBe(false);
  });
});
