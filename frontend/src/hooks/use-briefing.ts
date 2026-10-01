import { aiBriefingResponseSchema, type AiBriefing } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";
import { readAiError } from "@/lib/ai-errors";

/**
 * `disabled` is `AI_DISABLED`: the deployment has no assistant, and the
 * briefing is not shown anywhere. Every other failure — a busy provider
 * included — is an `error` the member can retry.
 */
export type BriefingState =
  | { status: "loading" }
  | { status: "ok"; briefing: AiBriefing; generatedAt: Date }
  | { status: "error"; message: string }
  | { status: "disabled" };

/**
 * ViewModel for the member's daily briefing, shared by the Overview card and
 * the briefing in AI Breakdown so the two never disagree. The server makes at
 * most one a club day and re-serves it after that, so reading on every mount —
 * and on every retry — is cheap.
 */
export function useBriefing() {
  const [state, setState] = useState<BriefingState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Awaited inside try, so even a fetch that throws before returning a
    // promise lands in the error state rather than breaking the page it sits on.
    async function load() {
      try {
        const response = await fetch("/api/ai/briefing", { credentials: "include" });
        if (!active) return;
        if (!response.ok) {
          const failure = await readAiError(response, "Failed to load the briefing");
          if (!active) return;
          setState(
            failure.disabled
              ? { status: "disabled" }
              : { status: "error", message: failure.message },
          );
          return;
        }
        const body = aiBriefingResponseSchema.parse(await response.json());
        if (active) {
          setState({
            status: "ok",
            briefing: body.briefing,
            generatedAt: new Date(body.generatedAt),
          });
        }
      } catch (cause) {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load the briefing",
          });
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  return { state, retry };
}
