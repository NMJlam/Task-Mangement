import { describe, expect, it } from "vitest";
import { auditActionSchema } from "./audit.js";

describe("auditActionSchema", () => {
  it("accepts the five event actions, and nothing else", () => {
    for (const action of [
      "event.created",
      "event.updated",
      "event.status_changed",
      "event.cancelled",
      "event.deleted",
    ]) {
      expect(auditActionSchema.safeParse(action).success).toBe(true);
    }
    expect(auditActionSchema.safeParse("event.archived").success).toBe(false);
  });
});
