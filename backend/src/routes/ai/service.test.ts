import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiQuotaError } from "../../lib/ai/client.js";
import {
  AiOutputError,
  briefingText,
  budgetMessages,
  buildBriefingPrompt,
  buildSummaryPrompt,
  clubDayKey,
  completeJson,
  conversationBlock,
  extractJson,
  mentionsAsNames,
} from "./service.js";

const schema = z.object({ ok: z.boolean() });

describe("extractJson", () => {
  it("passes bare JSON through", () => {
    expect(extractJson('{"ok":true}')).toEqual(['{"ok":true}']);
  });

  it("unwraps a fenced block, labelled or not, which Gemini emits even when asked not to", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual(['{"ok":true}']);
    expect(extractJson('```\n{"ok":true}\n```')).toEqual(['{"ok":true}']);
  });

  it("strips prose before the object", () => {
    expect(extractJson('Sure! Here you go:\n{"ok":true}')).toEqual(['{"ok":true}']);
  });

  it("returns every fenced block as a separate candidate, in order, not just the first", () => {
    const raw =
      'Format looks like:\n```json\n{"note":"draft"}\n```\n' +
      'My actual answer:\n```json\n{"ok":true}\n```';
    expect(extractJson(raw).slice(0, 2)).toEqual(['{"note":"draft"}', '{"ok":true}']);
  });
});

describe("completeJson", () => {
  it("returns the parsed value on the first attempt", async () => {
    const complete = vi.fn().mockResolvedValue('{"ok":true}');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first response does not satisfy the schema", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"ok":false}');
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("fails closed after two bad responses, so a partial write is impossible", async () => {
    const complete = vi.fn().mockResolvedValue("still not json");
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("finds the real object when an illustrative fence precedes it, with no retry needed", async () => {
    const raw =
      'Format looks like:\n```json\n{"note":"draft"}\n```\n' +
      'My actual answer:\n```json\n{"ok":true}\n```';
    const complete = vi.fn().mockResolvedValue(raw);
    await expect(completeJson(complete, "p", schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("fails closed on prose containing braces that are not a JSON object", async () => {
    const complete = vi.fn().mockResolvedValue("The value of x is {unknown} and y is {2}");
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("fails closed on two bare JSON objects with no fence to tell them apart", async () => {
    const complete = vi.fn().mockResolvedValue('{"ok":true}\n{"ok":false}');
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiOutputError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("propagates a rejection from complete rather than swallowing it into AiOutputError", async () => {
    const complete = vi.fn().mockRejectedValue(new AiQuotaError());
    await expect(completeJson(complete, "p", schema)).rejects.toBeInstanceOf(AiQuotaError);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("budgetMessages", () => {
  const message = (id: string, body: string) => ({
    id,
    author: "Alice",
    body,
    createdAt: new Date(0),
  });

  it("keeps everything when it fits", () => {
    expect(budgetMessages([message("1", "hello"), message("2", "world")], 1000)).toHaveLength(2);
  });

  it("drops the oldest first, because a catch-up needs the recent end", () => {
    const input = [
      message("1", "a".repeat(60)),
      message("2", "b".repeat(60)),
      message("3", "c".repeat(60)),
    ];
    expect(budgetMessages(input, 140).map((row) => row.id)).toEqual(["2", "3"]);
  });

  it("truncates one oversized message rather than dropping the whole thread", () => {
    const kept = budgetMessages([message("1", "x".repeat(500))], 100);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.body.length).toBeLessThanOrEqual(100);
  });
});

describe("clubDayKey", () => {
  it("returns the club's calendar day, not UTC's", () => {
    // 2026-10-14T22:30Z is already the 15th in Melbourne (UTC+11 in October).
    expect(clubDayKey(new Date("2026-10-14T22:30:00.000Z"), "Australia/Melbourne")).toBe(
      "2026-10-15",
    );
  });

  it("is stable across the same club day", () => {
    const zone = "Australia/Melbourne";
    const morning = clubDayKey(new Date("2026-10-14T00:00:00.000Z"), zone);
    const evening = clubDayKey(new Date("2026-10-14T08:00:00.000Z"), zone);
    expect(morning).toBe(evening);
  });
});

describe("buildBriefingPrompt", () => {
  const input = {
    memberName: "Alice",
    openTasks: [{ title: "Book the room", priority: "high", dueAt: "2026-10-16T12:59:00.000Z" }],
    overdueCount: 2,
    weekEvents: [
      { title: "Hack Night", startsAt: "2026-10-17T08:00:00.000Z", openTasks: 3, doneTasks: 5 },
    ],
    committeeLoad: [{ name: "Ben", openTaskCount: 9 }],
  };

  it("carries the figures it was given, so the model has nothing to guess", () => {
    const prompt = buildBriefingPrompt(input);
    for (const fact of ["Alice", "Book the room", "Hack Night", "Ben", "9"]) {
      expect(prompt).toContain(fact);
    }
  });

  it("asks for the briefing shape and forbids names not in the input", () => {
    const prompt = buildBriefingPrompt(input);
    expect(prompt).toContain('"bullets"');
    expect(prompt).toMatch(/only.*names?/iu);
  });
});

describe("briefingText", () => {
  it("reads as the summary followed by one dash line per bullet", () => {
    expect(
      briefingText({ summary: "A quiet day.", bullets: ["Book the room", "Chase pizza"] }),
    ).toBe("A quiet day.\n- Book the room\n- Chase pizza");
  });

  it("is just the summary when there are no bullets", () => {
    expect(briefingText({ summary: "Nothing on.", bullets: [] })).toBe("Nothing on.");
  });
});

describe("conversationBlock", () => {
  const said = (author: string, body: string) => ({
    id: body,
    author,
    body,
    createdAt: new Date(0),
  });

  it("is empty for a chat with no history, so a first message adds nothing to the prompt", () => {
    expect(conversationBlock([], 1000)).toBe("");
  });

  it("labels each line by who said it, oldest first", () => {
    expect(
      conversationBlock([said("MEMBER", "Plan it"), said("ASSISTANT", "Here is a plan.")], 1000),
    ).toBe("CONVERSATION SO FAR:\nMEMBER: Plan it\nASSISTANT: Here is a plan.");
  });

  it("drops the oldest messages once the budget is spent", () => {
    const block = conversationBlock(
      [said("MEMBER", "a".repeat(60)), said("ASSISTANT", "b".repeat(60)), said("MEMBER", "latest")],
      80,
    );
    expect(block).not.toContain("a".repeat(60));
    expect(block).toContain("latest");
  });
});

describe("mentionsAsNames", () => {
  const BEN = "0192f1a0-0000-7000-8000-0000000000b1";
  const names = new Map([[BEN, "Ben Lee"]]);
  const nameOf = (id: string) => names.get(id) ?? "a former member";

  it("reads each @mention token as the member it names", () => {
    expect(mentionsAsNames(`@[${BEN}] can you book the room?`, nameOf)).toBe(
      "@Ben Lee can you book the room?",
    );
  });

  it("reads a token in any case, as the composer's own parser does", () => {
    expect(mentionsAsNames(`thanks @[${BEN.toUpperCase()}]!`, nameOf)).toBe("thanks @Ben Lee!");
  });

  it("leaves text without a token, and an @ that is not one, as it was", () => {
    expect(mentionsAsNames("email me@club.org or @[not-an-id]", nameOf)).toBe(
      "email me@club.org or @[not-an-id]",
    );
  });
});

describe("buildSummaryPrompt", () => {
  const said = (author: string, body: string) => ({
    id: body,
    author,
    body,
    createdAt: new Date(0),
  });

  it("gives each message on its own line, with who wrote it", () => {
    const prompt = buildSummaryPrompt([
      said("dev@example.com", "@Leah Mueller what are you doing rn"),
      said("dev@example.com", "nothing lol"),
    ]);
    expect(prompt).toContain(
      '{"from":"dev@example.com","text":"@Leah Mueller what are you doing rn"}\n' +
        '{"from":"dev@example.com","text":"nothing lol"}',
    );
  });

  it("keeps a message with a line break on one line, so its second line has a writer", () => {
    const prompt = buildSummaryPrompt([said("Ada", "Room is booked.\nPizza is not.")]);
    expect(prompt).toContain('{"from":"Ada","text":"Room is booked.\\nPizza is not."}');
    expect(prompt.split("\n")).not.toContain("Pizza is not.");
  });

  it("says an @mention is who a message is to, not who wrote it", () => {
    const prompt = buildSummaryPrompt([said("Ada", "@Ben Lee are you free?")]);
    // A question to Ben followed by an answer is not Ben answering: the
    // writer of each message is its "from", whoever it addresses.
    expect(prompt).toMatch(
      /An @Name in the text is who the message is addressed to, not who wrote it/u,
    );
    expect(prompt).toMatch(
      /never assume a message is a reply from someone it does not name as "from"/u,
    );
  });

  it("lets an action item go to someone who was @mentioned, not only to a writer", () => {
    const prompt = buildSummaryPrompt([said("Ada", "@Ben Lee can you order pizza?")]);
    expect(prompt).toMatch(/Only use names that appear below, as a "from" or an @mention/u);
  });
});
