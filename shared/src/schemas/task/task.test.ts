import { describe, expect, it } from "vitest";
import { taskPrioritySchema, taskStatusSchema } from "./task.js";

describe("task schemas", () => {
  it("accepts known statuses and priorities", () => {
    expect(taskStatusSchema.safeParse("blocked").success).toBe(true);
    expect(taskPrioritySchema.safeParse("urgent").success).toBe(true);
  });

  it("rejects unknown statuses and priorities", () => {
    expect(taskStatusSchema.safeParse("archived").success).toBe(false);
    expect(taskPrioritySchema.safeParse("critical").success).toBe(false);
  });
});
