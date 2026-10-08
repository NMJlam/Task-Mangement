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
  it("asks the tier the matching route does: one task or an update at 0, a batch or an event at 1", () => {
    // POST /api/tasks, PATCH /api/tasks/:id, POST /api/tasks/bulk, POST /api/events.
    expect([...requiredTierFor([createTask()]).keys()]).toEqual([0]);
    expect([...requiredTierFor([updateTask]).keys()]).toEqual([0]);
    expect([...requiredTierFor([createTask(), createTask()]).keys()]).toContain(1);
    expect([...requiredTierFor([createEvent]).keys()]).toContain(1);
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
