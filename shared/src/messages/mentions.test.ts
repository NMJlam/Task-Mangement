import { describe, expect, it } from "vitest";
import { extractMentionedIds, mentionToken, splitMentions } from "./mentions.js";

const alice = "018f3a4b-0000-7000-8000-000000000001";
const bob = "018f3a4b-0000-7000-8000-000000000002";

describe("mentionToken", () => {
  it("wraps an id in the stored token shape", () => {
    expect(mentionToken(alice)).toBe(`@[${alice}]`);
  });
});

describe("extractMentionedIds", () => {
  it("finds one mention", () => {
    expect(extractMentionedIds(`Hey ${mentionToken(alice)}, can you take this?`)).toEqual([alice]);
  });

  it("finds several, in first-mentioned order", () => {
    expect(
      extractMentionedIds(`${mentionToken(bob)} and ${mentionToken(alice)} please review`),
    ).toEqual([bob, alice]);
  });

  it("dedupes a repeated mention to its first position", () => {
    expect(
      extractMentionedIds(
        `${mentionToken(alice)} — ${mentionToken(bob)} — ${mentionToken(alice)} again`,
      ),
    ).toEqual([alice, bob]);
  });

  it("returns nothing for plain text with no tokens", () => {
    expect(extractMentionedIds("no mentions here, just @ symbols and [brackets]")).toEqual([]);
  });

  it("ignores a token whose contents are not a UUID", () => {
    expect(extractMentionedIds("@[not-a-real-id] see above")).toEqual([]);
  });

  it("is case-insensitive on the hex digits", () => {
    expect(extractMentionedIds(`@[${alice.toUpperCase()}]`)).toEqual([alice]);
  });
});

describe("splitMentions", () => {
  it("returns the whole body as one part when there is no mention", () => {
    expect(splitMentions("just plain text")).toEqual(["just plain text"]);
  });

  it("splits text around a single mention", () => {
    expect(splitMentions(`hey ${mentionToken(alice)} check this`)).toEqual([
      "hey ",
      { userId: alice },
      " check this",
    ]);
  });

  it("handles a mention with no surrounding text on either side", () => {
    expect(splitMentions(mentionToken(alice))).toEqual([{ userId: alice }]);
  });

  it("splits around several mentions in order", () => {
    expect(splitMentions(`${mentionToken(bob)} and ${mentionToken(alice)}`)).toEqual([
      { userId: bob },
      " and ",
      { userId: alice },
    ]);
  });

  it("treats a malformed token as plain text", () => {
    expect(splitMentions("@[not-a-uuid] hi")).toEqual(["@[not-a-uuid] hi"]);
  });
});
