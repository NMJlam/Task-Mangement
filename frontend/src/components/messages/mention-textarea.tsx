import { mentionToken } from "@ctp/shared";
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

interface MentionCandidate {
  id: string;
  name: string | null;
  email: string;
}

/** The `@partial` run right before the caret, if any — `start` is where the
 * `@` itself sits, so a pick can splice the token in over exactly this span. */
interface OpenQuery {
  start: number;
  text: string;
}

/** The roster stores a name that may be blank, so email is the fallback. */
function label(candidate: MentionCandidate): string {
  return candidate.name || candidate.email;
}

/**
 * A plain `<textarea>` with an @mention popup layered on top. Typing `@`
 * opens it; picking someone splices `@[user-id]` in over the partial name —
 * the raw token stays visible while composing (see `message.ts`'s own note
 * on why: names aren't stored, only ids, so there is nothing prettier to show
 * yet). `MessageRow`'s `splitMentions` render is what turns it into a name
 * once the message is actually sent.
 *
 * Focus never leaves the textarea, so the list is driven from it the way a
 * combobox is: ↑/↓ move the highlight, Enter or Tab picks it, Escape closes
 * the list, and `aria-activedescendant` tells a screen reader which option is
 * highlighted. The options are still buttons, for a pointer.
 *
 * With the list closed, Enter submits the enclosing form and Shift+Enter is a
 * newline. That has to live here rather than in a caller's `onKeyDown`: the
 * caller's handler runs first, so it could not tell a send from a pick.
 */
export function MentionTextarea({
  value,
  onChange,
  candidates,
  selfId,
  onKeyDown,
  onBlur,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  candidates: readonly MentionCandidate[];
  selfId: string | undefined;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [query, setQuery] = useState<OpenQuery | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const needle = query?.text.toLowerCase() ?? "";
  const matches = query
    ? candidates
        .filter((candidate) => candidate.id !== selfId)
        .filter((candidate) =>
          [candidate.name ?? "", candidate.email].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
        .slice(0, 6)
    : [];
  const open = matches.length > 0;
  const active = Math.min(highlighted, matches.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    onChange(next);
    const caret = event.target.selectionStart;
    const upToCaret = next.slice(0, caret);
    // The run of non-space characters after the most recent "@" that hasn't
    // itself been closed off by a space — an "@" mid-word (an email address,
    // say) never opens this, because there is no word boundary before it.
    const match = /(?:^|\s)@([^\s@]*)$/.exec(upToCaret);
    setQuery(match ? { start: caret - match[1]!.length - 1, text: match[1]! } : null);
    setHighlighted(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (!open) {
      // Enter sends, Shift+Enter keeps a newline — the chat convention. An
      // IME's Enter is committing characters, not finishing the message.
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }
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
    const before = value.slice(0, query.start);
    const after = value.slice(query.start + 1 + query.text.length);
    const inserted = `${mentionToken(candidate.id)} `;
    const nextValue = `${before}${inserted}${after}`;
    onChange(nextValue);
    setQuery(null);
    const caret = before.length + inserted.length;
    // The value prop hasn't re-rendered into the DOM yet at this point in the
    // handler, so the selection has to be set on the next tick.
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(caret, caret);
      ref.current?.focus();
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
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
