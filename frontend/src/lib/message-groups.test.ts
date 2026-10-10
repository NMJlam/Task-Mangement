import type { Message } from "@ctp/shared";
import { describe, expect, it } from "vitest";
import { CONTINUATION_MS, continuations } from "./message-groups";

const ADA = "018f3a4b-0000-7000-8000-0000000000a1";
const BEN = "018f3a4b-0000-7000-8000-0000000000b2";
const CHANNEL = "018f3a4b-0000-7000-8000-0000000000c3";
const RUN_A = "018f3a4b-0000-7000-8000-0000000000d4";
const RUN_B = "018f3a4b-0000-7000-8000-0000000000e5";
const TASK = "018f3a4b-0000-7000-8000-0000000000f6";

let sequence = 0;
const START = new Date(2026, 9, 10, 9, 0, 0).getTime();

/** A message `offsetMs` after 09:00 local time on 10 October 2026. */
function message(offsetMs: number, overrides: Partial<Message> = {}): Message {
  sequence += 1;
  return {
    id: `018f3a4b-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    channelId: CHANNEL,
    taskId: null,
    parentId: null,
    author: ADA,
    body: `message ${sequence}`,
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: null,
    createdAt: new Date(START + offsetMs),
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

const grouped = (messages: Message[], searching = false) => continuations(messages, { searching });

describe("continuations", () => {
  it("continues the same sender's next message, and never the first", () => {
    expect(grouped([message(0), message(60_000), message(120_000)])).toEqual([false, true, true]);
  });

  it("breaks when the sender changes, and when they come back", () => {
    expect(grouped([message(0), message(1_000, { author: BEN }), message(2_000)])).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("continues at exactly five minutes, and not a moment after", () => {
    expect(grouped([message(0), message(CONTINUATION_MS)])).toEqual([false, true]);
    expect(grouped([message(0), message(CONTINUATION_MS + 1)])).toEqual([false, false]);
  });

  it("breaks at midnight, however close the two are", () => {
    const beforeMidnight = new Date(2026, 9, 10, 23, 59, 30).getTime() - START;
    const afterMidnight = new Date(2026, 9, 11, 0, 0, 30).getTime() - START;
    expect(grouped([message(beforeMidnight), message(afterMidnight)])).toEqual([false, false]);
  });

  it("never groups two former members just because neither has an author", () => {
    expect(grouped([message(0, { author: null }), message(1_000, { author: null })])).toEqual([
      false,
      false,
    ]);
  });

  it("keeps a member and the assistant posting under them apart, and two runs apart", () => {
    expect(grouped([message(0), message(1_000, { aiRunId: RUN_A })])).toEqual([false, false]);
    expect(grouped([message(0, { aiRunId: RUN_A }), message(1_000, { aiRunId: RUN_A })])).toEqual([
      false,
      true,
    ]);
    expect(grouped([message(0, { aiRunId: RUN_A }), message(1_000, { aiRunId: RUN_B })])).toEqual([
      false,
      false,
    ]);
  });

  it("breaks between a task comment and plain chat, and between a reply and its root", () => {
    expect(grouped([message(0), message(1_000, { taskId: TASK })])).toEqual([false, false]);
    const root = message(0);
    expect(grouped([root, message(1_000, { parentId: root.id })])).toEqual([false, false]);
  });

  it("lets a file with no caption stand alone", () => {
    const file = { fileKey: "k", fileName: "a.pdf", fileSizeBytes: 1, fileMime: "application/pdf" };
    expect(grouped([message(0), message(1_000, { ...file, body: "" }), message(2_000)])).toEqual([
      false,
      false,
      false,
    ]);
    // A captioned file is a message like any other.
    expect(grouped([message(0), message(1_000, file)])).toEqual([false, true]);
  });

  it("lets a deleted message stand alone and break the run on both sides", () => {
    const deleted = { body: "", deletedAt: new Date(START + 5_000), deletedBy: ADA };
    expect(grouped([message(0), message(1_000, deleted), message(2_000)])).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("gives every search result its own header", () => {
    expect(grouped([message(0), message(1_000)], true)).toEqual([false, false]);
  });

  it("re-reads from the whole array, so an older page can join the run above", () => {
    const first = message(60_000);
    const second = message(120_000);
    expect(grouped([first, second])).toEqual([false, true]);
    expect(grouped([message(0), first, second])).toEqual([false, true, true]);
  });
});
