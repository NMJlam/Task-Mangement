import { AI_MAX_PROPOSALS } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

const tools = [{ name: "listTasks", minTier: 0, describe: "List tasks", run: async () => [] }];

describe("buildSystemPrompt", () => {
  it("names every tool the caller is allowed to use", () => {
    expect(buildSystemPrompt(tools, "")).toContain("listTasks");
  });

  it("states the proposal cap, so the model does not draft a card nobody will read", () => {
    expect(buildSystemPrompt(tools, "")).toContain(String(AI_MAX_PROPOSALS));
  });

  it("tells the model to use handles rather than identifiers", () => {
    expect(buildSystemPrompt(tools, "")).toMatch(/handle/iu);
  });

  it("carries the seeded context into the prompt", () => {
    expect(buildSystemPrompt(tools, "Event: Hackathon 2026")).toContain("Hackathon 2026");
  });
});
