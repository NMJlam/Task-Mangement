import { mentionToken } from "@ctp/shared";
import { useRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from "react";

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

/**
 * A plain `<textarea>` with an @mention popup layered on top. Typing `@`
 * opens it; picking someone splices `@[user-id]` in over the partial name —
 * the raw token stays visible while composing (see `message.ts`'s own note
 * on why: names aren't stored, only ids, so there is nothing prettier to show
 * yet). `MessageRow`'s `splitMentions` render is what turns it into a name
 * once the message is actually sent.
 */
export function MentionTextarea({
  value,
  onChange,
  candidates,
  selfId,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  candidates: readonly MentionCandidate[];
  selfId: string | undefined;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<OpenQuery | null>(null);

  const matches = query
    ? candidates
        .filter((candidate) => candidate.id !== selfId)
        .filter((candidate) =>
          (candidate.name ?? candidate.email).toLowerCase().includes(query.text.toLowerCase()),
        )
        .slice(0, 6)
    : [];

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
        // A pick's onClick fires after this blur unless the mousedown that
        // starts it is prevented from moving focus in the first place.
        onBlur={() => setQuery(null)}
        {...props}
      />
      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(candidate)}
                className="w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                {candidate.name ?? candidate.email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
