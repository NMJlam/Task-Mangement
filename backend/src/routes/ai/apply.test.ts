import type { AiApplyOperation } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { orderOperations, requiredTierFor } from "./apply.js";

const uuid = (n: number) => `0192f1a0-0000-7000-8000-00000000000${n}`;

const createEvent: AiApplyOperation = {
  op: "create",
  entity: "event",
  ref: "$event1",
  data: { title: "Hackathon", startsAt: new Date("2026-10-14T09:00:00.000Z") },
};
const createTask = (eventRef?: string): AiApplyOperation => ({
  op: "create",
  entity: "task",
  data: { title: "Book venue", priority: "medium", assigneeIds: [], eventRef },
});
const updateTask: AiApplyOperation = {
  op: "update",
  entity: "task",
  id: uuid(1),
  data: { priority: "high" },
};

describe("requiredTierFor", () => {
  it("puts a single task create at tier 0, matching POST /api/tasks", () => {
    expect([...requiredTierFor([createTask()]).keys()]).toEqual([0]);
  });

  it("raises two or more task creates to tier 1, matching POST /api/tasks/bulk", () => {
    expect([...requiredTierFor([createTask(), createTask()]).keys()]).toContain(1);
  });

  it("puts an event create at tier 1", () => {
    expect([...requiredTierFor([createEvent]).keys()]).toContain(1);
  });

  it("leaves a task update at tier 0, matching PATCH /api/tasks/:id", () => {
    expect([...requiredTierFor([updateTask]).keys()]).toEqual([0]);
  });
});

describe("orderOperations", () => {
  it("creates a staged event before the tasks that name it", () => {
    const ordered = orderOperations([createTask("$event1"), createEvent]);
    expect(ordered[0]).toBe(createEvent);
  });

  it("leaves an order with no dependency untouched", () => {
    const input = [updateTask, createTask()];
    expect(orderOperations(input)).toEqual(input);
  });
});
