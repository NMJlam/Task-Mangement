import { describe, expect, it } from "vitest";
import {
  applyEdit,
  diffEdit,
  EMPTY_DRAFT,
  EMPTY_DRAFT_STATE,
  inferEdit,
  insertMention,
  mentionAt,
  recordEdit,
  redoDraft,
  serializeDraft,
  undoDraft,
  type MentionDraft,
} from "./mention-draft";

const GLENN = "018f3a4b-0000-7000-8000-0000000000a1";
const OTHER_GLENN = "018f3a4b-0000-7000-8000-0000000000b2";
const JO = "018f3a4b-0000-7000-8000-0000000000c3";

/** "hi @Glenn " — "hi @Gl" with Glenn picked from the list. */
function withGlenn(): MentionDraft {
  return insertMention({ text: "hi @Gl", mentions: [] }, { start: 3, end: 6 }, "Glenn", GLENN)
    .draft;
}

/** Applies the edit a browser would report for `before` → `after` at `selection`. */
function type(
  draft: MentionDraft,
  after: string,
  selection?: { start: number; end: number },
  inputType?: string,
) {
  return applyEdit(draft, inferEdit(draft.text, after, selection, inputType));
}

describe("insertMention", () => {
  it("shows the name, records the id over exactly the name, and puts the caret after a space", () => {
    const { draft, caret } = insertMention(
      { text: "hi @Gl", mentions: [] },
      { start: 3, end: 6 },
      "Glenn",
      GLENN,
    );
    expect(draft.text).toBe("hi @Glenn ");
    expect(draft.mentions).toEqual([{ start: 3, end: 9, userId: GLENN, display: "@Glenn" }]);
    expect(caret).toBe(10);
  });

  it("keeps two members with the same name apart by the id each was picked as", () => {
    const first = withGlenn();
    const second = insertMention(
      { ...first, text: `${first.text}@G` },
      { start: 10, end: 12 },
      "Glenn",
      OTHER_GLENN,
    ).draft;
    expect(serializeDraft(second)).toBe(`hi @[${GLENN}] @[${OTHER_GLENN}] `);
  });
});

describe("serializeDraft", () => {
  it("sends each mention as its token and every other character as typed", () => {
    let draft = withGlenn();
    draft = type(draft, `${draft.text}and\n\t  @Jo!`, { start: 10, end: 10 });
    const jo = insertMention(draft, { start: 17, end: 20 }, "Jo", JO).draft;
    expect(serializeDraft(jo)).toBe(`hi @[${GLENN}] and\n\t  @[${JO}] !`);
  });

  it("sends a draft with no mentions unchanged", () => {
    expect(serializeDraft({ text: " plain @Glenn text ", mentions: [] })).toBe(
      " plain @Glenn text ",
    );
  });

  it("sends a range whose characters changed under it as the text it now is", () => {
    const draft = withGlenn();
    const tampered = { ...draft, text: "hi @Glebe " };
    expect(serializeDraft(tampered)).toBe("hi @Glebe ");
  });
});

describe("applyEdit", () => {
  it("shifts a mention when text goes in before it", () => {
    const draft = type(withGlenn(), "oh hi @Glenn ", { start: 0, end: 0 });
    expect(draft.mentions).toMatchObject([{ start: 6, end: 12 }]);
    expect(serializeDraft(draft)).toBe(`oh hi @[${GLENN}] `);
  });

  it("leaves a mention whole when typing right at either edge of it", () => {
    const after = type(withGlenn(), "hi @Glenn, ", { start: 9, end: 9 });
    expect(serializeDraft(after)).toBe(`hi @[${GLENN}], `);
    const before = type(withGlenn(), "hi (@Glenn ", { start: 3, end: 3 });
    expect(serializeDraft(before)).toBe(`hi (@[${GLENN}] `);
  });

  it("turns a mention edited inside back into plain text", () => {
    const draft = type(withGlenn(), "hi @Glen ", { start: 9, end: 9 }, "deleteContentBackward");
    expect(draft.mentions).toEqual([]);
    expect(serializeDraft(draft)).toBe("hi @Glen ");
  });

  it("drops a mention a selection replaced, and keeps the rest", () => {
    const draft = type(withGlenn(), "hi everyone ", { start: 3, end: 9 });
    expect(draft).toEqual({ text: "hi everyone ", mentions: [] });
  });

  it("drops a mention cut out along with its neighbours", () => {
    expect(type(withGlenn(), "h", { start: 1, end: 10 }, "deleteByCut")).toEqual({
      text: "h",
      mentions: [],
    });
  });
});

describe("inferEdit", () => {
  it("tells deleting the last letter of a name from deleting the letter after it", () => {
    // "@Glennn": the mention is "@Glenn", the last n is typed after it.
    const draft: MentionDraft = {
      text: "@Glennn",
      mentions: [{ start: 0, end: 6, userId: GLENN, display: "@Glenn" }],
    };
    // Backspace with the caret after the plain n: the mention survives.
    expect(
      type(draft, "@Glenn", { start: 7, end: 7 }, "deleteContentBackward").mentions,
    ).toHaveLength(1);
    // Backspace with the caret inside the name: the same text, but no mention.
    expect(
      type(draft, "@Glenn", { start: 6, end: 6 }, "deleteContentBackward").mentions,
    ).toHaveLength(0);
  });

  it("reads Delete forward from the caret", () => {
    expect(inferEdit("abc", "ac", { start: 1, end: 1 }, "deleteContentForward")).toEqual({
      start: 1,
      end: 2,
      text: "",
    });
  });

  it("reads a multi-line paste over a selection", () => {
    expect(inferEdit("one two", "one a\nb", { start: 4, end: 7 }, "insertFromPaste")).toEqual({
      start: 4,
      end: 7,
      text: "a\nb",
    });
  });

  it("falls back to the smallest edit when the selection cannot explain the change", () => {
    // A stale selection, as autofill or spell correction leaves.
    expect(inferEdit("teh cat", "the cat", { start: 7, end: 7 })).toEqual(
      diffEdit("teh cat", "the cat"),
    );
    expect(diffEdit("teh cat", "the cat")).toEqual({ start: 1, end: 3, text: "he" });
  });
});

describe("mentionAt", () => {
  it("finds the mention covering a position, and none at its end", () => {
    const draft = withGlenn();
    expect(mentionAt(draft, 3)?.userId).toBe(GLENN);
    expect(mentionAt(draft, 9)).toBeUndefined();
    expect(mentionAt(EMPTY_DRAFT, 0)).toBeUndefined();
  });
});

describe("history", () => {
  const caret = (at: number) => ({ start: at, end: at });

  /** Types `text` one key at a time from the end of the draft. */
  function typeOut(state: typeof EMPTY_DRAFT_STATE, text: string) {
    let next = state;
    for (const character of text) {
      const at = next.draft.text.length;
      next = recordEdit(next, applyEdit(next.draft, { start: at, end: at, text: character }), {
        kind: "insert",
        selectionBefore: caret(at),
        caretAfter: at + 1,
        inserted: character,
      });
    }
    return next;
  }

  it("undoes typing a word at a time, and redoes it", () => {
    const typed = typeOut(EMPTY_DRAFT_STATE, "hello world");
    const once = undoDraft(typed, caret(11))!;
    expect(once.state.draft.text).toBe("hello ");
    expect(once.selection).toEqual(caret(6));
    const twice = undoDraft(once.state, once.selection)!;
    expect(twice.state.draft.text).toBe("");
    expect(undoDraft(twice.state, twice.selection)).toBeUndefined();

    const again = redoDraft(twice.state, twice.selection)!;
    expect(again.state.draft.text).toBe("hello ");
    expect(redoDraft(again.state, again.selection)!.state.draft.text).toBe("hello world");
  });

  it("brings a picked mention back with its id, not as plain text", () => {
    const typed = typeOut(EMPTY_DRAFT_STATE, "hi @Gl");
    const picked = insertMention(typed.draft, { start: 3, end: 6 }, "Glenn", GLENN);
    const withMention = recordEdit(typed, picked.draft, {
      kind: "mention",
      selectionBefore: caret(6),
      caretAfter: picked.caret,
    });
    const cleared = recordEdit(withMention, EMPTY_DRAFT, {
      kind: "other",
      selectionBefore: { start: 0, end: 10 },
      caretAfter: 0,
    });

    const undone = undoDraft(cleared, caret(0))!;
    expect(serializeDraft(undone.state.draft)).toBe(`hi @[${GLENN}] `);
    const beforePick = undoDraft(undone.state, undone.selection)!;
    expect(beforePick.state.draft).toEqual({ text: "hi @Gl", mentions: [] });
    const redone = redoDraft(beforePick.state, beforePick.selection)!;
    expect(serializeDraft(redone.state.draft)).toBe(`hi @[${GLENN}] `);
  });

  it("starts a new step when typing jumps elsewhere, and forgets redo on a new edit", () => {
    const typed = typeOut(EMPTY_DRAFT_STATE, "ab");
    const elsewhere = recordEdit(typed, applyEdit(typed.draft, { start: 0, end: 0, text: "x" }), {
      kind: "insert",
      selectionBefore: caret(0),
      caretAfter: 1,
      inserted: "x",
    });
    expect(undoDraft(elsewhere, caret(1))!.state.draft.text).toBe("ab");

    const undone = undoDraft(elsewhere, caret(1))!;
    const branched = typeOut(undone.state, "c");
    expect(redoDraft(branched, caret(3))).toBeUndefined();
  });
});
