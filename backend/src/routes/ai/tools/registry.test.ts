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
