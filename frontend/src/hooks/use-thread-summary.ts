import { aiThreadSummaryResponseSchema, type AiThreadSummary } from "@ctp/shared";
import { useCallback, useState } from "react";

/**
 * `idle` until the member asks: a summary spends the club's shared AI quota, so
 * opening a thread never does it on its own. `disabled` is a 503.
 */
type ThreadSummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; summary: AiThreadSummary; asOfMessageId: string }
  | { status: "error"; message: string }
  | { status: "disabled" };

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "Couldn't summarise this thread.";
  } catch {
    return "Couldn't summarise this thread.";
  }
}

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
      if (response.status === 503) {
        setState({ status: "disabled" });
        return;
      }
      if (!response.ok) {
        setState({ status: "error", message: await errorMessage(response) });
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
