import { describe, expect, it } from "vitest";
import { chatTitleFrom } from "./chats.js";

describe("chatTitleFrom", () => {
  it("uses a short first message as it is", () => {
    expect(chatTitleFrom("Plan the hack night")).toBe("Plan the hack night");
  });

  it("collapses line breaks and runs of spaces, so a pasted paragraph is one line", () => {
    expect(chatTitleFrom("  Plan\n\nthe   hack\tnight ")).toBe("Plan the hack night");
  });

  it("cuts a long message to sixty characters, ending in an ellipsis", () => {
    const title = chatTitleFrom("a".repeat(200));
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("leaves a message of exactly sixty characters uncut", () => {
    expect(chatTitleFrom("b".repeat(60))).toBe("b".repeat(60));
  });

  it("does not leave a space hanging before the ellipsis", () => {
    const title = chatTitleFrom(`${"c".repeat(58)} and then much more text`);
    expect(title).toBe(`${"c".repeat(58)}…`);
  });
});
