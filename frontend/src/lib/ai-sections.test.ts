import type { AiResolvedProposal } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { deriveSections } from "./ai-sections";

const TASK_ID = "0192f1a0-0000-7000-8000-000000000001";

const newTask = (title: string, eventRef?: string) => ({
  title,
  priority: "medium" as const,
  dueAt: null,
  assignees: [],
  eventRef,
});

describe("deriveSections", () => {
  it("labels a task create section", () => {
    const [section] = deriveSections({ createTasks: [newTask("Book venue")] });
    expect(section?.label).toBe("Create tasks");
  });

  it("labels an event create section", () => {
    const [section] = deriveSections({
      createEvent: { ref: "$event1", title: "Hackathon", startsAt: new Date() },
    });
    expect(section?.label).toBe("Create event");
  });

  it("calls a task diff that touches only assignees a reassignment", () => {
    const proposal: AiResolvedProposal = {
      updateTasks: [
        {
          id: TASK_ID,
          title: "Poster",
          diffs: [{ field: "assignees", before: "Ann", after: "Ben" }],
        },
      ],
    };
    const [section] = deriveSections(proposal);
    expect(section?.kind).toBe("reassign-task");
    expect(section?.label).toBe("Reassign tasks");
  });

  it("calls a task diff touching any other field an update", () => {
    const [section] = deriveSections({
      updateTasks: [
        {
          id: TASK_ID,
          title: "Poster",
          diffs: [
            { field: "assignees", before: "Ann", after: "Ben" },
            { field: "priority", before: "medium", after: "high" },
          ],
        },
      ],
    });
    expect(section?.kind).toBe("update-task");
    expect(section?.label).toBe("Update tasks");
  });

  it("orders a created event before the tasks that depend on it", () => {
    const sections = deriveSections({
      createTasks: [newTask("Book venue", "$event1")],
      createEvent: { ref: "$event1", title: "Hackathon", startsAt: new Date() },
    });
    expect(sections[0]?.kind).toBe("create-event");
  });
});
