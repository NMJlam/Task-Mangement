import { AI_MAX_PROPOSALS } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt.js";

const tools = [{ name: "listTasks", minTier: 0, describe: "List tasks", run: async () => [] }];
const me = { handle: "M1", name: "Alice", role: "treasurer" };

describe("buildSystemPrompt", () => {
  it("names every tool the caller is allowed to use", () => {
    expect(buildSystemPrompt(tools, "", me)).toContain("listTasks");
  });

  it("states the proposal cap, so the model does not draft a card nobody will read", () => {
    expect(buildSystemPrompt(tools, "", me)).toContain(String(AI_MAX_PROPOSALS));
  });

  it("tells the model to use handles rather than identifiers", () => {
    expect(buildSystemPrompt(tools, "", me)).toMatch(/handle/iu);
  });

  it("carries the seeded context into the prompt", () => {
    expect(buildSystemPrompt(tools, "Event: Hackathon 2026", me)).toContain("Hackathon 2026");
  });
});

describe("buildSystemPrompt and the calendar", () => {
  it("tells the model today's date, so a plan can be dated without guessing the year", () => {
    const prompt = buildSystemPrompt(tools, "", me, new Date("2026-09-30T13:30:00Z"));

    // 13:30 UTC on the 30th is still the 30th in Melbourne — and a Wednesday.
    expect(prompt).toContain("Wednesday, 30 September 2026");
  });

  it("tells the model to choose a date itself rather than stall when none was given", () => {
    expect(buildSystemPrompt(tools, "", me, new Date())).toMatch(/no date[^.]*choose/iu);
  });
});

describe("buildSystemPrompt and the member's reading of a reply", () => {
  it("tells the model to speak in names and titles, since a handle means nothing to a member", () => {
    expect(buildSystemPrompt(tools, "", me)).toMatch(/reply[^.]*names[^.]*never[^.]*handle/iu);
  });
});

describe("buildSystemPrompt and who is asking", () => {
  it("names the caller and reads 'my' as their handle, so 'my tasks' are not the club's", () => {
    const prompt = buildSystemPrompt(tools, "", me);
    expect(prompt).toContain("Alice (M1)");
    expect(prompt).toMatch(/"my" mean M1[^]*assigneeHandle M1/u);
  });
});
