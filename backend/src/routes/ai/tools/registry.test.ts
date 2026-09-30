import { describe, expect, it } from "vitest";
import { HandleMap } from "../handles.js";
import { runTool, toolsFor } from "./registry.js";

// `staged: {}` is added to the brief's fixture: `ToolContext.staged` is
// `AiProposal`, a required field (every one of its OWN fields is optional,
// but the field itself is not) — `{}` is itself a valid empty `AiProposal`,
// same as an answer that proposes nothing.
const ctx = () => ({
  db: {} as never,
  userId: "0192f1a0-0000-7000-8000-000000000001",
  tier: 0,
  handles: new HandleMap(),
  staged: {},
});

describe("toolsFor", () => {
  it("offers every read tool at tier 0", () => {
    expect(toolsFor(0).map((tool) => tool.name)).toContain("listTasks");
  });

  it("withholds a tier-1 propose tool from a tier-0 caller", () => {
    // A length comparison alone would pass with tier filtering removed
    // entirely — this is the security boundary, so assert membership.
    const names = toolsFor(0).map((tool) => tool.name);
    expect(names).not.toContain("proposeCreateEvent");
    expect(names).not.toContain("proposeUpdateEvent");
  });

  it("offers a tier-1 propose tool to a tier-1 caller", () => {
    const names = toolsFor(1).map((tool) => tool.name);
    expect(names).toContain("proposeCreateEvent");
    expect(names).toContain("proposeUpdateEvent");
  });

  it("never offers a tool that writes", () => {
    for (const tier of [0, 1, 2]) {
      const names = toolsFor(tier).map((tool) => tool.name);
      expect(names).not.toContain("createExpense");
      expect(names).not.toContain("deleteTask");
      expect(names).not.toContain("cancelEvent");
    }
  });
});

describe("runTool", () => {
  it("returns a refusal to the model rather than throwing, when the tier is short", async () => {
    const result = await runTool({ ...ctx(), tier: 0 }, "proposeCreateEvent", {});
    expect(JSON.stringify(result)).toMatch(/permission/iu);
  });

  it("returns a refusal for a tool name that does not exist", async () => {
    const result = await runTool(ctx(), "nonsenseTool", {});
    expect(JSON.stringify(result)).toMatch(/unknown/iu);
  });
});

/**
 * A model only knows a tool from its description. These are the defects a
 * scripted model can never surface: it does not have to read the instructions.
 */
describe("what the model is told about the propose tools", () => {
  const described = (name: string) => toolsFor(2).find((tool) => tool.name === name)!.describe;

  it("names every argument an event needs, and the date format", () => {
    for (const argument of ["ref", "title", "startsAt", "endsAt", "venue", "description"]) {
      expect(described("proposeCreateEvent")).toContain(argument);
    }
    expect(described("proposeCreateEvent")).toMatch(/ISO/u);
  });

  it("names every field a new task takes", () => {
    for (const field of ["title", "description", "priority", "dueOffsetDays", "assigneeHandles"]) {
      expect(described("proposeCreateTasks")).toContain(field);
    }
  });

  it("says which field was wrong when it rejects an event, so the model can correct it", async () => {
    const result = await runTool({ ...ctx(), tier: 1 }, "proposeCreateEvent", {
      ref: "$event1",
      title: "Poker Bot Hackathon",
    });

    expect(result).toEqual({ error: expect.stringContaining("startsAt") });
  });

  it("says which task and field was wrong when it rejects a batch", async () => {
    const result = await runTool({ ...ctx(), tier: 1 }, "proposeCreateTasks", {
      tasks: [{ title: "Book venue" }, { title: "Order chips", priority: "asap" }],
    });

    expect(result).toEqual({ error: expect.stringContaining("tasks.1.priority") });
  });
});
