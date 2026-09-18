import { describe, expect, it } from "vitest";
import { commentRecipients, escapeLike, replyProblem } from "./service.js";

const THREAD = "018f3a4b-0000-7000-8000-000000000001";
const OTHER_THREAD = "018f3a4b-0000-7000-8000-000000000002";
const ROOT = "018f3a4b-0000-7000-8000-000000000003";

describe("replyProblem (rule 11)", () => {
  it("allows a reply to a top-level message in the same thread", () => {
    expect(replyProblem({ channelId: THREAD, parentId: null }, THREAD)).toBeUndefined();
  });

  it("rejects a missing parent and one from another thread alike", () => {
    expect(replyProblem(undefined, THREAD)).toMatch(/no message/i);
    expect(replyProblem({ channelId: OTHER_THREAD, parentId: null }, THREAD)).toMatch(
      /no message/i,
    );
  });

  it("rejects a reply to a reply", () => {
    expect(replyProblem({ channelId: THREAD, parentId: ROOT }, THREAD)).toMatch(/one level/i);
  });
});

describe("commentRecipients", () => {
  it("notifies every assignee and the creator once each, never the author", () => {
    expect(commentRecipients({ assigneeIds: ["a", "b"], creator: "c" }, "x")).toEqual([
      "a",
      "b",
      "c",
    ]);
    // A member who is both assignee and creator hears once.
    expect(commentRecipients({ assigneeIds: ["a", "a"], creator: "a" }, "x")).toEqual(["a"]);
    // The author is dropped even when assigned.
    expect(commentRecipients({ assigneeIds: ["a"], creator: "c" }, "a")).toEqual(["c"]);
    expect(commentRecipients({ assigneeIds: [], creator: null }, "x")).toEqual([]);
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("50% off_now\\")).toBe("50\\% off\\_now\\\\");
  });
});
