import { describe, expect, it } from "vitest";
import {
  AI_MAX_PROPOSALS,
  aiApplyRequestSchema,
  aiHandleSchema,
  aiProposalSchema,
  aiRefSchema,
  aiResolvedProposalSchema,
  aiThreadSummarySchema,
} from "./ai.js";

describe("aiHandleSchema", () => {
  it("accepts the handles read tools issue", () => {
    for (const handle of ["T1", "E12", "M300"]) {
      expect(aiHandleSchema.safeParse(handle).success).toBe(true);
    }
  });

  it("rejects a UUID, which the model must never emit", () => {
    const uuid = "0192f1a0-0000-7000-8000-000000000000";
    expect(aiHandleSchema.safeParse(uuid).success).toBe(false);
  });

  it("rejects junk before or after an otherwise-valid handle — the pattern is fully anchored", () => {
    // Without the leading `^`, "T1" would still match as a suffix of "xT1".
    expect(aiHandleSchema.safeParse("xT1").success).toBe(false);
    // Without the trailing `$`, "T1" would still match as a prefix of "T1x".
    expect(aiHandleSchema.safeParse("T1x").success).toBe(false);
  });
});

describe("aiRefSchema", () => {
  it("accepts a staged-row ref", () => {
    expect(aiRefSchema.safeParse("$event1").success).toBe(true);
  });

  it("rejects a handle, which names an existing row instead", () => {
    expect(aiRefSchema.safeParse("T1").success).toBe(false);
  });

  it("rejects junk after an otherwise-valid ref — the pattern is fully anchored", () => {
    // Without the trailing `$`, "$event1" would still match as a prefix of "$event1!".
    expect(aiRefSchema.safeParse("$event1!").success).toBe(false);
  });
});

describe("aiProposalSchema", () => {
  const task = { title: "Book venue" };

  it("accepts a plan of one event and its tasks", () => {
    const parsed = aiProposalSchema.safeParse({
      createEvent: {
        ref: "$event1",
        title: "Hackathon 2026",
        startsAt: "2026-10-14T09:00:00.000Z",
      },
      createTasks: [{ ...task, eventRef: "$event1", dueOffsetDays: -21 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("caps a single turn at AI_MAX_PROPOSALS tasks", () => {
    const tasks = Array.from({ length: AI_MAX_PROPOSALS + 1 }, () => task);
    expect(aiProposalSchema.safeParse({ createTasks: tasks }).success).toBe(false);
  });

  it("caps the combined total across createTasks and updateTasks, not each array alone", () => {
    // 16 + 16 clears each array's own .max(AI_MAX_PROPOSALS) individually —
    // only the cross-field refine can catch the combined total of 32.
    const newTasks = Array.from({ length: 16 }, () => task);
    const diffs = Array.from({ length: 16 }, () => ({ handle: "T1", title: "Renamed" }));
    const parsed = aiProposalSchema.safeParse({ createTasks: newTasks, updateTasks: diffs });
    expect(parsed.success).toBe(false);
  });

  it("counts createEvent toward the cap too, not just the task arrays", () => {
    const tasks = Array.from({ length: AI_MAX_PROPOSALS }, () => task);
    const parsed = aiProposalSchema.safeParse({
      createEvent: {
        ref: "$event1",
        title: "Hackathon 2026",
        startsAt: "2026-10-14T09:00:00.000Z",
      },
      createTasks: tasks,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a reassignment as a task diff", () => {
    const parsed = aiProposalSchema.safeParse({
      updateTasks: [{ handle: "T7", assigneeHandles: ["M2"] }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an event status of cancelled — cancellation has one door", () => {
    const parsed = aiProposalSchema.safeParse({
      updateEvent: { handle: "E1", status: "cancelled" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("aiResolvedProposalSchema", () => {
  const id = "0192f1a0-0000-7000-8000-000000000000";

  it("carries an id and each diff's before value, so a card can render before → after", () => {
    const parsed = aiResolvedProposalSchema.safeParse({
      updateTasks: [
        {
          id,
          title: "Print name badges",
          diffs: [{ field: "assignees", before: "Ben Ng", after: "Aisha K" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a handle where an id belongs — handles never leave the backend", () => {
    const parsed = aiResolvedProposalSchema.safeParse({
      updateTasks: [
        { id: "T7", title: "x", diffs: [{ field: "priority", before: "low", after: "high" }] },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("aiApplyRequestSchema", () => {
  it("requires at least one operation", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [],
      stats: { proposed: 0, kept: 0, edited: 0 },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a create bound to a staged event", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [
        {
          op: "create",
          entity: "event",
          ref: "$event1",
          data: { title: "H", startsAt: "2026-10-14T09:00:00.000Z" },
        },
        { op: "create", entity: "task", data: { title: "Book venue", eventRef: "$event1" } },
      ],
      stats: { proposed: 2, kept: 2, edited: 0 },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an update to an existing task", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [
        {
          op: "update",
          entity: "task",
          id: "0192f1a0-0000-7000-8000-000000000000",
          data: { title: "Book venue (confirmed)" },
        },
      ],
      stats: { proposed: 1, kept: 1, edited: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an update to an existing event", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [
        {
          op: "update",
          entity: "event",
          id: "0192f1a0-0000-7000-8000-000000000000",
          data: { venue: "New venue" },
        },
      ],
      stats: { proposed: 1, kept: 1, edited: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an operation whose entity the nested union does not recognise", () => {
    const parsed = aiApplyRequestSchema.safeParse({
      runId: "0192f1a0-0000-7000-8000-000000000000",
      operations: [
        {
          op: "update",
          entity: "member",
          id: "0192f1a0-0000-7000-8000-000000000000",
          data: { title: "x" },
        },
      ],
      stats: { proposed: 1, kept: 1, edited: 0 },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("aiThreadSummarySchema", () => {
  it("accepts bullets with an unassigned action item", () => {
    const parsed = aiThreadSummarySchema.safeParse({
      summary: ["Venue is booked."],
      actionItems: [{ text: "Chase catering", suggestedAssigneeName: null }],
    });
    expect(parsed.success).toBe(true);
  });
});
