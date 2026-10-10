import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MentionTextarea } from "./mention-textarea";
import { EMPTY_DRAFT_STATE, serializeDraft, type DraftState } from "@/lib/mention-draft";

const JAMIE = { id: "018f3a4b-0000-7000-8000-0000000000a1", name: "Jamie Lee", email: "j@x.io" };
const JORDAN = { id: "018f3a4b-0000-7000-8000-0000000000b2", name: "Jordan Kim", email: "k@x.io" };
// The roster stores a blank name as "", not null.
const UNNAMED = { id: "018f3a4b-0000-7000-8000-0000000000c3", name: "", email: "sam@club.org" };
const KAI = { id: "018f3a4b-0000-7000-8000-0000000000e5", name: "Kai", email: "kai@x.io" };
// Two members can share a name; only the id tells them apart.
const OTHER_JAMIE = {
  id: "018f3a4b-0000-7000-8000-0000000000d4",
  name: "Jamie Lee",
  email: "o@x.io",
};

/** The box, and beside it the body that would be sent — the canonical form. */
function Composer({ candidates = [JAMIE, JORDAN, UNNAMED] }: { candidates?: (typeof JAMIE)[] }) {
  const [value, setValue] = useState<DraftState>(EMPTY_DRAFT_STATE);
  return (
    <>
      <MentionTextarea
        aria-label="Message"
        value={value}
        onChange={setValue}
        candidates={candidates}
        selfId={undefined}
      />
      <output data-testid="sent">{serializeDraft(value.draft)}</output>
    </>
  );
}

const box = () => screen.getByLabelText<HTMLTextAreaElement>("Message");
const sent = () => screen.getByTestId("sent").textContent;

/** The whole value after a change, with the caret where `caret` says (its end by default). */
function typeInto(text: string, caret = text.length) {
  fireEvent.change(box(), { target: { value: text, selectionStart: caret, selectionEnd: caret } });
  return box();
}

/** Selects `[start, end)` — the caret, when they are equal — as the arrow keys would. */
function select(start: number, end = start) {
  box().setSelectionRange(start, end);
  fireEvent.keyDown(box(), { key: "ArrowLeft" });
}

it("moves the highlight with the arrow keys and picks it with Enter, showing the name", () => {
  render(<Composer />);
  const textarea = typeInto("hi @J");

  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Jamie Lee", "Jordan Kim"]);
  // The highlight is announced from the textarea, where focus stays.
  expect(textarea).toHaveAttribute("aria-activedescendant", options[0]!.id);
  expect(options[0]).toHaveAttribute("aria-selected", "true");

  fireEvent.keyDown(textarea, { key: "ArrowDown" });
  expect(textarea).toHaveAttribute("aria-activedescendant", options[1]!.id);
  fireEvent.keyDown(textarea, { key: "ArrowDown" });
  // It wraps.
  expect(textarea).toHaveAttribute("aria-activedescendant", options[0]!.id);
  fireEvent.keyDown(textarea, { key: "ArrowUp" });
  fireEvent.keyDown(textarea, { key: "Enter" });

  // The box shows the name; only what is sent carries the id.
  expect(textarea).toHaveValue("hi @Jordan Kim ");
  expect(textarea.value).not.toContain(JORDAN.id);
  expect(sent()).toBe(`hi @[${JORDAN.id}] `);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("picks with Tab and with a click too, and closes without picking on Escape", () => {
  render(<Composer />);
  let textarea = typeInto("@Ja");
  fireEvent.keyDown(textarea, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(textarea).toHaveValue("@Ja");
  expect(textarea).not.toHaveAttribute("aria-activedescendant");

  // One more letter: React only reports a change when the value moves.
  textarea = typeInto("@Jam");
  fireEvent.keyDown(textarea, { key: "Tab" });
  expect(textarea).toHaveValue("@Jamie Lee ");

  typeInto("@Jamie Lee @Jo");
  fireEvent.click(screen.getByRole("option", { name: "Jordan Kim" }));
  expect(textarea).toHaveValue("@Jamie Lee @Jordan Kim ");
  expect(sent()).toBe(`@[${JAMIE.id}] @[${JORDAN.id}] `);
});

it("keeps two members with the same name apart by whom was picked", () => {
  render(<Composer candidates={[JAMIE, OTHER_JAMIE]} />);
  typeInto("@Ja");
  fireEvent.keyDown(box(), { key: "ArrowDown" });
  fireEvent.keyDown(box(), { key: "Enter" });

  expect(box()).toHaveValue("@Jamie Lee ");
  expect(sent()).toBe(`@[${OTHER_JAMIE.id}] `);
});

it("sends a name typed or pasted by hand as plain text, never as anyone's id", () => {
  render(<Composer />);
  typeInto("thanks @Jamie Lee!");
  fireEvent.keyDown(box(), { key: "Escape" });
  expect(sent()).toBe("thanks @Jamie Lee!");
});

it("lists a member with a blank name by email, and finds them by it", () => {
  render(<Composer />);

  typeInto("@");
  expect(screen.getByRole("option", { name: "sam@club.org" })).toBeInTheDocument();

  typeInto("@sam");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "sam@club.org",
  ]);
});

describe("editing around a mention", () => {
  function picked() {
    render(<Composer />);
    typeInto("hi @Jam");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("hi @Jamie Lee ");
  }

  it("moves the mention along when text goes in before it", () => {
    picked();
    select(0);
    typeInto("oh hi @Jamie Lee ", 3);
    expect(sent()).toBe(`oh hi @[${JAMIE.id}] `);
  });

  it("leaves it whole when typing carries on after it", () => {
    picked();
    typeInto("hi @Jamie Lee and more");
    expect(sent()).toBe(`hi @[${JAMIE.id}] and more`);
  });

  it("turns it back into plain text once its name is edited", () => {
    picked();
    select(13);
    typeInto("hi @Jamie Le ", 12);
    expect(sent()).toBe("hi @Jamie Le ");
  });

  it("does not reopen the list over a name already picked", () => {
    render(<Composer candidates={[KAI]} />);
    typeInto("hi @Ka");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("hi @Kai ");

    // Backspace the space after it: the caret now sits right after "@Kai".
    select(8);
    typeInto("hi @Kai", 7);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(sent()).toBe(`hi @[${KAI.id}]`);
  });
});

describe("undo and redo", () => {
  it("restores the pre-command caret on redo after native undo", () => {
    render(<Composer />);
    typeInto("@Jam");
    fireEvent.keyDown(box(), { key: "Enter" });
    const picked = box().value;
    const complete = picked + "checking.";
    typeInto(complete);
    // Chromium has already removed the period and moved its native caret.
    fireEvent.input(box(), {
      target: {
        value: complete.slice(0, -1),
        selectionStart: complete.length - 1,
        selectionEnd: complete.length - 1,
      },
      inputType: "historyUndo",
    });
    expect(box()).toHaveValue(picked);
    fireEvent.keyDown(box(), { key: "z", ctrlKey: true, shiftKey: true });
    expect(box()).toHaveValue(complete);
    expect(box().selectionStart).toBe(complete.length);
    expect(sent()).toBe(`@[${JAMIE.id}] checking.`);
  });
  it.each([false, true])(
    "preserves mention metadata on native history input (noncancelable beforeinput: %s)",
    (announced) => {
      render(<Composer />);
      typeInto("hi @Jam");
      fireEvent.keyDown(box(), { key: "Enter" });
      select(0, box().value.length);
      typeInto("", 0);
      if (announced)
        box().dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: false,
            inputType: "historyUndo",
          }),
        );
      fireEvent.input(box(), { target: { value: "hi @Jamie Lee " }, inputType: "historyUndo" });
      expect(sent()).toBe(`hi @[${JAMIE.id}] `);
      if (announced)
        box().dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: false,
            inputType: "historyRedo",
          }),
        );
      fireEvent.input(box(), { target: { value: "" }, inputType: "historyRedo" });
      expect(sent()).toBe("");
      fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
      expect(sent()).toBe(`hi @[${JAMIE.id}] `);
    },
  );
  it("brings a mention back with whom it names, through the draft's own history", () => {
    render(<Composer />);
    typeInto("hi @Jam");
    fireEvent.keyDown(box(), { key: "Enter" });
    // Select all and delete it.
    select(0, box().value.length);
    typeInto("", 0);
    expect(sent()).toBe("");

    const undone = fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    // The browser's own undo is held back: it knows nothing of mentions.
    expect(undone).toBe(false);
    expect(box()).toHaveValue("hi @Jamie Lee ");
    expect(sent()).toBe(`hi @[${JAMIE.id}] `);

    fireEvent.keyDown(box(), { key: "z", ctrlKey: true });
    expect(box()).toHaveValue("hi @Jam");

    fireEvent.keyDown(box(), { key: "z", ctrlKey: true, shiftKey: true });
    expect(sent()).toBe(`hi @[${JAMIE.id}] `);
    fireEvent.keyDown(box(), { key: "y", ctrlKey: true });
    expect(box()).toHaveValue("");
  });
});

describe("Enter", () => {
  function InForm({ onSubmit }: { onSubmit: () => void }) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Composer />
      </form>
    );
  }

  it("sends the message with the list closed", () => {
    const onSubmit = vi.fn();
    render(<InForm onSubmit={onSubmit} />);
    const textarea = typeInto("no mention here");

    const unhandled = fireEvent.keyDown(textarea, { key: "Enter" });

    // Prevented, so no newline lands in the box on its way out.
    expect(unhandled).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves Shift+Enter to the textarea, as a newline — with the list open too", () => {
    const onSubmit = vi.fn();
    render(<InForm onSubmit={onSubmit} />);
    expect(fireEvent.keyDown(typeInto("first line"), { key: "Enter", shiftKey: true })).toBe(true);

    typeInto("first line @Ja");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(fireEvent.keyDown(box(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(box()).toHaveValue("first line @Ja");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves an IME's Enter alone, list open or closed: it is committing characters", () => {
    const onSubmit = vi.fn();
    render(<InForm onSubmit={onSubmit} />);
    expect(fireEvent.keyDown(typeInto("にほん"), { key: "Enter", isComposing: true })).toBe(true);

    typeInto("@Ja");
    expect(fireEvent.keyDown(box(), { key: "Enter", isComposing: true })).toBe(true);
    expect(box()).toHaveValue("@Ja");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("picks the highlighted mention instead while the list is open, and the next Enter sends", () => {
    const onSubmit = vi.fn();
    render(<InForm onSubmit={onSubmit} />);
    const textarea = typeInto("hi @Jam");

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea).toHaveValue("hi @Jamie Lee ");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

it.each([JAMIE, UNNAMED])(
  "keeps the picker open for a full email and serializes the selected member: $email",
  (candidate) => {
    render(<Composer candidates={[candidate]} />);
    typeInto("Thanks @" + candidate.email);
    expect(
      screen.getByRole("option", { name: candidate.name || candidate.email }),
    ).toBeInTheDocument();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("Thanks @" + (candidate.name || candidate.email) + " ");
    expect(sent()).toBe("Thanks @[" + candidate.id + "] ");
  },
);

it("ranks an exact email username above more than six broad matches", () => {
  const director = { ...UNNAMED, name: "a@example.com", email: "a@example.com" };
  const broad = Array.from({ length: 7 }, (_, index) => ({
    ...JAMIE,
    id: "broad-" + index,
    name: "A team member " + index,
    email: "team" + index + "@example.com",
  }));
  render(<Composer candidates={[...broad, director]} />);
  typeInto("@a");
  expect(screen.getAllByRole("option")).toHaveLength(6);
  expect(screen.getAllByRole("option")[0]).toHaveTextContent(director.email);
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(box()).toHaveValue("@a@example.com ");
  expect(sent()).toBe("@[" + director.id + "] ");
});
