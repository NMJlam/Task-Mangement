import { useEffect } from "react";

/**
 * Re-runs a hook's read when the data is likely to have moved on.
 *
 * Every ViewModel in this app fetches once on mount and then never again, so a
 * tab left open shows whatever was true when it loaded — a notification badge
 * that never lights up, a thread that never gains a message. This is the piece
 * that was missing; hooks opt in by passing their own `reload`.
 *
 * Two triggers, both cheap:
 *
 * - **Coming back to the tab.** `visibilitychange` covers switching tabs and
 *   unminimising; `focus` covers moving between windows, where visibility never
 *   changes. Both fire for one return, so the callback must be idempotent — it
 *   is, because a reload is a refetch.
 * - **A poll, but only while visible.** A background tab polling all night is
 *   the thing that makes this pattern expensive on a serverless backend, so the
 *   interval checks visibility before firing rather than being torn down and
 *   rebuilt on every switch.
 *
 * `reload` MUST be referentially stable (a `useCallback` with no changing
 * deps) — an unstable one re-subscribes on every render and, with `intervalMs`,
 * restarts the timer before it can ever fire.
 */
export function useRevalidate(
  reload: () => void,
  { intervalMs, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
): void {
  useEffect(() => {
    if (!enabled) return;

    function onVisible() {
      if (document.visibilityState === "visible") reload();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reload);
    const timer =
      intervalMs === undefined
        ? undefined
        : window.setInterval(() => {
            if (document.visibilityState === "visible") reload();
          }, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reload);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [reload, intervalMs, enabled]);
}
