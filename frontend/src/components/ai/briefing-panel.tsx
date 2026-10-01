import { MessageSquarePlus, RefreshCw, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { BriefingState } from "@/hooks/use-briefing";

const preparedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The right column at `/ai/briefing`: today's briefing, and a box to ask about
 * it. Asking starts a new chat that opens with the briefing as its first
 * message (spec M14), so the assistant knows what "this" is and every
 * follow-up in that chat does too.
 */
export function BriefingPanel({
  state,
  retry,
  onAsk,
  pending,
  error,
}: {
  state: BriefingState;
  retry: () => void;
  /** Resolves false when the turn failed, so the question goes back in the box. */
  onAsk: (text: string) => Promise<boolean>;
  pending: boolean;
  error: string | undefined;
}) {
  const [draft, setDraft] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    if (!(await onAsk(text))) setDraft(text);
  }

  return (
    <section aria-labelledby="ai-briefing-heading" className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-4 sm:px-6">
        <h2
          id="ai-briefing-heading"
          className="flex min-w-0 flex-1 items-center gap-2 font-semibold tracking-tight"
        >
          <Sparkles aria-hidden="true" className="size-4 text-primary" />
          Today&apos;s briefing
        </h2>
        {state.status === "ok" && (
          <p className="text-xs text-muted-foreground">
            Prepared{" "}
            <time dateTime={state.generatedAt.toISOString()}>
              {preparedAt.format(state.generatedAt)}
            </time>
          </p>
        )}
      </header>

      <div className="flex-1 px-4 py-5 text-sm leading-6 sm:px-6">
        {state.status === "loading" && (
          <p className="text-muted-foreground" role="status">
            Preparing your briefing…
          </p>
        )}
        {state.status === "disabled" && (
          <p className="text-muted-foreground">
            The assistant is switched off on this deployment, so there is no briefing.
          </p>
        )}
        {state.status === "error" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground">Couldn&apos;t prepare today&apos;s briefing.</p>
            <Button variant="outline" size="sm" onClick={retry}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}
        {state.status === "ok" && (
          <article className="rounded-lg border bg-background p-4">
            <p className="text-base">{state.briefing.summary}</p>
            {state.briefing.bullets.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {state.briefing.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </article>
        )}
        {pending && (
          <p className="mt-4 text-muted-foreground" role="status">
            Starting a chat about it…
          </p>
        )}
      </div>

      {state.status === "ok" && (
        <div className="border-t p-4 sm:px-6">
          {error && (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={(event) => void submit(event)} className="flex items-end gap-2">
            <label htmlFor="briefing-question" className="sr-only">
              Ask about this…
            </label>
            <textarea
              id="briefing-question"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="What should I do first?"
              className="min-h-10 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button type="submit" disabled={pending || !draft.trim()}>
              <MessageSquarePlus aria-hidden="true" />
              Ask
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
