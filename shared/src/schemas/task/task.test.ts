import { describe, expect, it } from "vitest";
import {
  bulkCreateTasksSchema,
  createTaskSchema,
  listTasksQuerySchema,
  overdueTasksQuerySchema,
  taskListResponseSchema,
  taskParamsSchema,
  updateTaskSchema,
} from "./task.js";

const teamId = "018f3a4b-0000-7000-8000-000000000001";
const eventId = "018f3a4b-0000-7000-8000-000000000002";
const legacyTaskId = "6c283ddb-61a9-37dd-d39b-201e49b643ae";

describe("task identifiers", () => {
  it("accepts UUID-shaped legacy ids already stored by Postgres", () => {
    const task = {
      id: legacyTaskId,
      eventId: null,
      teamId: null,
      assigneeIds: [],
      creator: null,
      title: "Legacy task",
      description: null,
      status: "todo",
      priority: "medium",
      dueAt: null,
      boardOrder: 0,
      minTier: 0,
      completedAt: null,
      aiRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(taskListResponseSchema.parse({ tasks: [task] }).tasks[0]?.id).toBe(legacyTaskId);
    expect(taskParamsSchema.parse({ id: legacyTaskId }).id).toBe(legacyTaskId);
  });
});
const memberId = "018f3a4b-0000-7000-8000-000000000003";
const otherMemberId = "018f3a4b-0000-7000-8000-000000000004";

describe("createTaskSchema", () => {
  it("trims the title and defaults status and priority", () => {
    const task = createTaskSchema.parse({ teamId, title: "  Book the venue  " });
    expect(task.title).toBe("Book the venue");
    expect(task.status).toBe("todo");
    expect(task.priority).toBe("medium");
  });

  it("defaults the assignee set to empty, so an unowned task needs no field", () => {
    expect(createTaskSchema.parse({ teamId, title: "Ok" }).assigneeIds).toEqual([]);
  });

  it("trims a description, and collapses an all-whitespace one to null", () => {
    expect(createTaskSchema.parse({ teamId, title: "Ok", description: "  hi  " }).description).toBe(
      "hi",
    );
    expect(
      createTaskSchema.parse({ teamId, title: "Ok", description: "   " }).description,
    ).toBeNull();
    expect(createTaskSchema.parse({ teamId, title: "Ok" }).description).toBeUndefined();
  });

  it("rejects a description past the 2000-character cap", () => {
    expect(
      createTaskSchema.safeParse({ teamId, title: "Ok", description: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("collapses a repeated id to first-seen order", () => {
    expect(
      createTaskSchema.parse({
        teamId,
        title: "Ok",
        assigneeIds: [memberId, otherMemberId, memberId],
      }).assigneeIds,
    ).toEqual([memberId, otherMemberId]);
  });

  it("rejects a non-uuid assignee id", () => {
    expect(
      createTaskSchema.safeParse({ teamId, title: "Ok", assigneeIds: ["director"] }).success,
    ).toBe(false);
  });

  it("rejects a blank title", () => {
    expect(createTaskSchema.safeParse({ teamId, title: "   " }).success).toBe(false);
  });

  it("accepts blocked, which is a first-class status", () => {
    expect(createTaskSchema.parse({ teamId, title: "Ok", status: "blocked" }).status).toBe(
      "blocked",
    );
  });

  it("rejects an unknown status", () => {
    expect(createTaskSchema.safeParse({ teamId, title: "Ok", status: "archived" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown priority", () => {
    expect(createTaskSchema.safeParse({ teamId, title: "Ok", priority: "asap" }).success).toBe(
      false,
    );
  });

  it("rejects a non-uuid teamId", () => {
    expect(createTaskSchema.safeParse({ teamId: "team-1", title: "Ok" }).success).toBe(false);
  });

  it("accepts an eventId, alone or paired with a teamId", () => {
    expect(createTaskSchema.parse({ eventId, title: "Ok" }).eventId).toBe(eventId);
    expect(createTaskSchema.parse({ eventId, teamId, title: "Ok" })).toMatchObject({
      eventId,
      teamId,
    });
  });

  it("rejects a non-uuid eventId", () => {
    expect(createTaskSchema.safeParse({ eventId: "oweek", title: "Ok" }).success).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("accepts a single-field patch", () => {
    expect(updateTaskSchema.parse({ status: "done" })).toEqual({ status: "done" });
  });

  it("leaves the assignee set out when the patch omits it — omission is 'unchanged'", () => {
    expect("assigneeIds" in updateTaskSchema.parse({ title: "Renamed" })).toBe(false);
  });

  it("leaves the description out when omitted, and accepts null to clear it", () => {
    expect("description" in updateTaskSchema.parse({ title: "Renamed" })).toBe(false);
    expect(updateTaskSchema.parse({ description: null }).description).toBeNull();
    // An emptied field reaches the server as "" — one clear, two spellings.
    expect(updateTaskSchema.parse({ description: "" }).description).toBeNull();
  });

  it("accepts an empty set, which clears every assignment", () => {
    expect(updateTaskSchema.parse({ assigneeIds: [] }).assigneeIds).toEqual([]);
  });

  it("collapses duplicates in a patch too", () => {
    expect(updateTaskSchema.parse({ assigneeIds: [memberId, memberId] }).assigneeIds).toEqual([
      memberId,
    ]);
  });

  it("accepts eventId as the only field, including null to unlink", () => {
    expect(updateTaskSchema.parse({ eventId })).toEqual({ eventId });
    expect(updateTaskSchema.parse({ eventId: null })).toEqual({ eventId: null });
  });

  it("rejects an empty patch", () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });
});

describe("bulkCreateTasksSchema", () => {
  it("rejects an empty batch", () => {
    expect(bulkCreateTasksSchema.safeParse({ tasks: [] }).success).toBe(false);
  });

  it("rejects a batch over the 100-task cap", () => {
    const tasks = Array.from({ length: 101 }, (_, index) => ({ teamId, title: `Task ${index}` }));
    expect(bulkCreateTasksSchema.safeParse({ tasks }).success).toBe(false);
  });
});

describe("listTasksQuerySchema", () => {
  it("applies pagination defaults", () => {
    expect(listTasksQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
  });

  it("coerces numeric strings from the query string", () => {
    expect(listTasksQuerySchema.parse({ limit: "10", offset: "20" })).toMatchObject({
      limit: 10,
      offset: 20,
    });
  });

  it("rejects a limit above the cap", () => {
    expect(listTasksQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("accepts an eventId filter and rejects a non-uuid one", () => {
    expect(listTasksQuerySchema.parse({ eventId }).eventId).toBe(eventId);
    expect(listTasksQuerySchema.safeParse({ eventId: "oweek" }).success).toBe(false);
  });
});

describe("overdueTasksQuerySchema", () => {
  it("accepts an eventId filter", () => {
    expect(overdueTasksQuerySchema.parse({ eventId }).eventId).toBe(eventId);
  });
});
