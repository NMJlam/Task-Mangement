import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useThreadSummary } from "@/hooks/use-thread-summary";

/**
 * A catch-up for a long thread, run only when asked. Once one is showing, the
 * same control re-runs it — the server answers from cache until someone posts,
 * so asking again on an unchanged thread costs nothing.
 */
export function ThreadSummaryPanel({ channelId }: { channelId: string }) {
  const { state, summarise } = useThreadSummary(channelId);
  if (state.status === "disabled") return null;

  const showing = state.status === "ok";
  return (
    <section aria-labelledby="thread-summary-heading" className="mb-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="thread-summary-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles aria-hidden="true" className="size-4 text-muted-foreground" />
          Catch up
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void summarise()}
          disabled={state.status === "loading"}
        >
          {showing ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {showing ? "Summarise again" : "Summarise thread"}
        </Button>
      </div>

      {state.status === "loading" && (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Reading the thread…
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {showing && (
        <div className="mt-3 grid gap-3 text-sm leading-6">
          <ul className="list-disc space-y-1 pl-5">
            {state.summary.summary.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {state.summary.actionItems.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                Action items
              </h4>
              <ul className="mt-1 space-y-1">
                {state.summary.actionItems.map((item) => (
                  <li key={item.text}>
                    {item.text}
                    {item.suggestedAssigneeName && (
                      <span className="text-muted-foreground"> — {item.suggestedAssigneeName}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
