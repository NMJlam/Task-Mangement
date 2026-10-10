import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
  type TextareaHTMLAttributes,
} from "react";
import {
  applyEdit,
  inferEdit,
  insertMention,
  mentionAt,
  recordEdit,
  redoDraft,
  undoDraft,
  type DraftState,
  type EditKind,
  type MentionDraft,
  type Selection,
} from "@/lib/mention-draft";
import { cn } from "@/lib/utils";

interface MentionCandidate {
  id: string;
  name: string | null;
  email: string;
}

/** The `@partial` run right before the caret, if any — `start` is where the
 * `@` itself sits, so a pick can put the mention in over exactly this span. */
interface OpenQuery {
  start: number;
  text: string;
}

/** The roster stores a name that may be blank, so email is the fallback. */
function label(candidate: MentionCandidate): string {
  return candidate.name || candidate.email;
}

/** Exact names, emails and email usernames beat broad substring matches,
 * so a short username cannot disappear behind the six-result limit. */
function matchRank(candidate: MentionCandidate, needle: string): number {
  if (!needle) return 0;
  const fields = [candidate.name ?? "", candidate.email, candidate.email.split("@")[0] ?? ""].map(
    (field) => field.toLowerCase(),
  );
  if (fields.some((field) => field === needle)) return 0;
  if (fields.some((field) => field.startsWith(needle))) return 1;
  return 2;
}

function selectionOf(box: HTMLTextAreaElement): Selection {
  return { start: box.selectionStart, end: box.selectionEnd };
}

/** Which undo step an edit belongs to; see `recordEdit`. */
function kindOf(edit: { start: number; end: number; text: string }, inputType?: string): EditKind {
  if (inputType === "deleteByCut" || inputType?.startsWith("insertFrom")) return "other";
  if (edit.text === "") return "delete";
  return edit.start === edit.end ? "insert" : "other";
}

/**
 * A plain `<textarea>` with an @mention popup layered on top. Typing `@`
 * opens it; picking someone puts "@Their Name" in the box — the name, never
 * the id — and the draft (`lib/mention-draft.ts`) remembers that those
 * characters are a mention of that member. The `@[user-id]` token the API
 * stores is built only when the message is sent.
 *
 * Because the box shows names, it has to follow every edit to keep the
 * mentions over the right characters: the selection just before each change
 * (from `beforeinput`) says where it happened, and an edit that reaches into a
 * mention turns it back into plain text. Undo and Redo go through the draft's
 * own history, which carries the mentions with the text — the browser's would
 * bring back the words but not whom they name.
 *
 * Focus never leaves the textarea, so the list is driven from it the way a
 * combobox is: ↑/↓ move the highlight, Enter or Tab picks it, Escape closes
 * the list, and `aria-activedescendant` tells a screen reader which option is
 * highlighted. The options are still buttons, for a pointer.
 *
 * With the list closed, Enter submits the enclosing form; Shift+Enter is
 * always a newline. That has to live here rather than in a caller's
 * `onKeyDown`: the caller's handler runs first, so it could not tell a send
 * from a pick. An IME's Enter is committing characters, so it does neither.
 */
export function MentionTextarea({
  value,
  onChange,
  candidates,
  selfId,
  onKeyDown,
  onBlur,
  onSelect,
  ...props
}: {
  value: DraftState;
  onChange: (value: DraftState) => void;
  candidates: readonly MentionCandidate[];
  selfId: string | undefined;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [query, setQuery] = useState<OpenQuery | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Where the selection was just before the browser changed the text, and how.
  const beforeInput = useRef<{ selection: Selection; inputType: string } | undefined>(undefined);
  // The last selection seen, for a change no `beforeinput` announced.
  const lastSelection = useRef<Selection>({ start: 0, end: 0 });
  // Where the caret goes once a change made here (a pick, an undo) is on screen.
  const pendingCaret = useRef<Selection | undefined>(undefined);
  // `value` as of the last render, for the native listener below.
  const current = useRef(value);

  const needle = query?.text.toLowerCase() ?? "";
  const matches = query
    ? candidates
        .filter((candidate) => candidate.id !== selfId)
        .filter((candidate) =>
          [candidate.name ?? "", candidate.email].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
        .sort((left, right) => matchRank(left, needle) - matchRank(right, needle))
        .slice(0, 6)
    : [];
  const open = matches.length > 0;
  const active = Math.min(highlighted, matches.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useLayoutEffect(() => {
    current.current = value;
    const caret = pendingCaret.current;
    const box = ref.current;
    if (!caret || !box) return;
    pendingCaret.current = undefined;
    box.setSelectionRange(caret.start, caret.end);
    lastSelection.current = caret;
  }, [value]);

  /** Opens the list over an `@partial` just before the caret — never over a mention already picked. */
  function updateQuery(draft: MentionDraft, caret: number) {
    const match = /(?:^|\s)@([^\s]*)$/.exec(draft.text.slice(0, caret));
    const start = match ? caret - match[1]!.length - 1 : -1;
    setQuery(match && !mentionAt(draft, start) ? { start, text: match[1]! } : null);
    setHighlighted(0);
  }

  /** Applies an undo or redo step from the draft's own history. */
  function step(direction: "undo" | "redo", state: DraftState, before?: Selection) {
    const box = ref.current;
    const selection = before ?? (box ? selectionOf(box) : { start: 0, end: 0 });
    const result = direction === "undo" ? undoDraft(state, selection) : redoDraft(state, selection);
    if (!result) return;
    pendingCaret.current = result.selection;
    setQuery(null);
    onChange(result.state);
  }
  const stepRef = useRef(step);
  useLayoutEffect(() => {
    stepRef.current = step;
  });

  // `beforeinput` is the one event that fires before the text changes, so it
  // is where the selection the change replaces can still be read. React's
  // `onBeforeInput` is not it — it never fires for a deletion.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    function onBeforeInput(event: InputEvent) {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        if (event.cancelable) {
          event.preventDefault();
          stepRef.current(event.inputType === "historyUndo" ? "undo" : "redo", current.current);
        } else {
          beforeInput.current = { selection: selectionOf(box!), inputType: event.inputType };
        }
        return;
      }
      beforeInput.current = { selection: selectionOf(box!), inputType: event.inputType };
    }
    box.addEventListener("beforeinput", onBeforeInput);
    return () => box.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const box = event.target;
    const inputType = (event.nativeEvent as InputEvent).inputType;
    // Browser edit commands may emit input without beforeinput. Treat that
    // history event as an undo/redo, rather than recording it as a fresh edit
    // and clearing the redo stack (or losing restored mention metadata).
    if (inputType === "historyUndo" || inputType === "historyRedo") {
      const selectionBefore = beforeInput.current?.selection ?? lastSelection.current;
      beforeInput.current = undefined;
      step(inputType === "historyUndo" ? "undo" : "redo", value, selectionBefore);
      return;
    }
    const announced = beforeInput.current;
    beforeInput.current = undefined;
    // Mid-composition the selection is the IME's, not the member's: only the
    // text itself can say what changed.
    const composing = (event.nativeEvent as InputEvent).isComposing === true;
    const selectionBefore = composing ? undefined : (announced?.selection ?? lastSelection.current);
    const edit = inferEdit(value.draft.text, box.value, selectionBefore, announced?.inputType);
    const next = applyEdit(value.draft, edit);
    const caret = box.selectionStart;
    lastSelection.current = selectionOf(box);
    onChange(
      recordEdit(value, next, {
        kind: kindOf(edit, announced?.inputType),
        selectionBefore: selectionBefore ?? { start: edit.start, end: edit.end },
        caretAfter: caret,
        inserted: edit.text,
      }),
    );
    updateQuery(next, caret);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    lastSelection.current = selectionOf(event.currentTarget);
    const composing = event.nativeEvent.isComposing;

    // The draft's own history, not the browser's: see above.
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "z" || key === "y")) {
      event.preventDefault();
      step(key === "y" || event.shiftKey ? "redo" : "undo", value);
      return;
    }

    if (!open) {
      if (event.key === "Enter" && !event.shiftKey && !composing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }
    if (composing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlighted((active + 1) % matches.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlighted((active - 1 + matches.length) % matches.length);
        break;
      case "Enter":
        // Shift+Enter is a newline even with the list open.
        if (event.shiftKey) {
          setQuery(null);
          break;
        }
        event.preventDefault();
        pick(matches[active]!);
        break;
      case "Tab":
        event.preventDefault();
        pick(matches[active]!);
        break;
      case "Escape":
        event.preventDefault();
        setQuery(null);
        break;
    }
  }

  function pick(candidate: MentionCandidate) {
    if (!query) return;
    const end = query.start + 1 + query.text.length;
    const { draft, caret } = insertMention(
      value.draft,
      { start: query.start, end },
      label(candidate),
      candidate.id,
    );
    pendingCaret.current = { start: caret, end: caret };
    setQuery(null);
    onChange(
      recordEdit(value, draft, {
        kind: "mention",
        selectionBefore: { start: end, end },
        caretAfter: caret,
      }),
    );
    ref.current?.focus();
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value.draft.text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) => {
          lastSelection.current = selectionOf(event.currentTarget);
          onSelect?.(event);
        }}
        // A pick's onClick fires after this blur unless the mousedown that
        // starts it is prevented from moving focus in the first place.
        onBlur={(event) => {
          onBlur?.(event);
          setQuery(null);
        }}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        {...props}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground"
        >
          {matches.map((candidate, index) => (
            <li key={candidate.id} role="presentation">
              <button
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={index === active}
                // Reached from the textarea's arrow keys, not the tab order.
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(candidate)}
                className={cn(
                  "w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  index === active && "bg-accent text-accent-foreground",
                )}
              >
                {label(candidate)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
