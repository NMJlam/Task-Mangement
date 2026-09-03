import { describe, expect, it } from "vitest";
import { notificationKindSchema } from "./notification.js";

describe("notification schemas", () => {
  it("accepts known kinds", () => {
    expect(notificationKindSchema.safeParse("mention").success).toBe(true);
  });

  it("rejects unknown kinds", () => {
    expect(notificationKindSchema.safeParse("task_deleted").success).toBe(false);
  });
});
