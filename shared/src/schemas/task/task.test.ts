import { describe, expect, it } from "vitest";
import {
  bulkCreateTasksSchema,
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from "./task.js";

const teamId = "018f3a4b-0000-7000-8000-000000000001";

describe("createTaskSchema", () => {
  it("trims the title and defaults status to todo", () => {
    const task = createTaskSchema.parse({ teamId, title: "  Book the venue  " });
    expect(task.title).toBe("Book the venue");
    expect(task.status).toBe("todo");
  });

  it("rejects a blank title", () => {
    expect(createTaskSchema.safeParse({ teamId, title: "   " }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(createTaskSchema.safeParse({ teamId, title: "Ok", status: "blocked" }).success).toBe(
      false,
    );
  });

  it("rejects a non-uuid teamId", () => {
    expect(createTaskSchema.safeParse({ teamId: "team-1", title: "Ok" }).success).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("accepts a single-field patch", () => {
    expect(updateTaskSchema.parse({ status: "done" })).toEqual({ status: "done" });
  });

  it("allows clearing a nullable field", () => {
    expect(updateTaskSchema.parse({ assigneeId: null }).assigneeId).toBeNull();
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
});
