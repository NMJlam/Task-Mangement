import {
  aiThreadSummaryResponseSchema,
  aiThreadSummaryValidityResponseSchema,
  type AiThreadSummary,
} from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRevalidate } from "@/hooks/use-revalidate";
import { readAiError } from "@/lib/ai-errors";

/** As often as the thread under it re-reads, so a deletion shows in both together. */
const CHECK_MS = 15_000;

/**
 * `idle` until the member asks: a summary spends the club's shared AI quota, so
 * opening a thread never does it on its own. `disabled` is `AI_DISABLED`.
 * `stale` is a summary taken down because a message it was written from has
 * since been deleted.
 */
type ThreadSummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ok";
      summary: AiThreadSummary;
      asOfMessageId: string;
      sourceFingerprint: string;
    }
  | { status: "error"; message: string }
  | { status: "disabled" }
  | { status: "stale" };

/**
 * ViewModel for one thread's on-demand summary.
 *
 * A summary on screen is checked against the thread on every poll and return
 * to the tab, and whenever `sourceVersion` moves (the page bumps it when a
 * message is deleted from it). The check calls no model: it asks whether the
 * messages the summary was written from are still all there. New messages do
 * not make it stale — it is a summary as of then — but a deleted one does, so
 * words that are gone never stay on screen in summary form.
 */
export function useThreadSummary(channelId: string, sourceVersion = 0) {
  const [state, setState] = useState<ThreadSummaryState>({ status: "idle" });
  const latest = useRef(state);

  useEffect(() => {
    latest.current = state;
  }, [state]);

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
      setState({ status: "ok", ...body });
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Couldn't summarise this thread.",
      });
    }
  }, [channelId]);

  const check = useCallback(async () => {
    const shown = latest.current;
    if (shown.status !== "ok") return;
    const params = new URLSearchParams({
      asOf: shown.asOfMessageId,
      fingerprint: shown.sourceFingerprint,
    });
    try {
      const response = await fetch(`/api/ai/threads/${channelId}/summary/validity?${params}`, {
        credentials: "include",
      });
      // The thread itself gone from view is the page's to handle; a failed
      // check proves nothing, so the summary stands until one succeeds.
      if (!response.ok) return;
      const { current } = aiThreadSummaryValidityResponseSchema.parse(await response.json());
      // Only the summary that was checked: a new one asked for meanwhile stands.
      if (!current) setState((now) => (now === shown ? { status: "stale" } : now));
    } catch {
      // As above: the next poll tries again.
    }
  }, [channelId]);

  const revalidate = useCallback(() => void check(), [check]);
  useRevalidate(revalidate, { intervalMs: CHECK_MS, enabled: state.status === "ok" });

  useEffect(() => {
    if (sourceVersion > 0) void check();
  }, [sourceVersion, check]);

  return { state, summarise };
}
