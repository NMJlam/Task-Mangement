import { describe, expect, it } from "vitest";
import { auditActionSchema } from "./audit.js";

describe("auditActionSchema", () => {
  it("accepts the four event actions", () => {
    for (const action of [
      "event.created",
      "event.updated",
      "event.status_changed",
      "event.cancelled",
    ]) {
      expect(auditActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("rejects an unknown action", () => {
    expect(auditActionSchema.safeParse("event.deleted").success).toBe(false);
  });
});
