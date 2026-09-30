import { aiThreadSummaryResponseSchema, type AiThreadSummary } from "@ctp/shared";
import { useCallback, useState } from "react";
import { readAiError } from "@/lib/ai-errors";

/**
 * `idle` until the member asks: a summary spends the club's shared AI quota, so
 * opening a thread never does it on its own. `disabled` is `AI_DISABLED`.
 */
type ThreadSummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; summary: AiThreadSummary; asOfMessageId: string }
  | { status: "error"; message: string }
  | { status: "disabled" };

/** ViewModel for one thread's on-demand summary. */
export function useThreadSummary(channelId: string) {
  const [state, setState] = useState<ThreadSummaryState>({ status: "idle" });

  const summarise = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/ai/threads/${channelId}/summary`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const failure = await readAiError(response, "Couldn't summarise this thread.");
        setState(
          failure.disabled ? { status: "disabled" } : { status: "error", message: failure.message },
        );
        return;
      }
      const body = aiThreadSummaryResponseSchema.parse(await response.json());
      setState({ status: "ok", summary: body.summary, asOfMessageId: body.asOfMessageId });
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Couldn't summarise this thread.",
      });
    }
  }, [channelId]);

  return { state, summarise };
}
