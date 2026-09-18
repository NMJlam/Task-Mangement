import { eventResponseSchema, type EventDetail } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

type EventState =
  | { status: "loading" }
  | { status: "ok"; event: EventDetail; warnings?: string[] }
  | { status: "not_found" }
  | { status: "error"; message: string };

/** ViewModel for a single event (GET /api/events/:id). */
export function useEvent(id: string | undefined) {
  const [state, setState] = useState<EventState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    if (!id) return;
    let active = true;
    setState({ status: "loading" });

    // `channel` is asked for by name — `channelId` is absent without it, and the
    // Thread tab has nothing to read.
    fetch(`/api/events/${id}?include=tasks,channel`, { credentials: "include" })
      .then(async (res) => {
        if (res.status === 404) return { status: "not_found" as const };
        if (!res.ok) throw new Error("Failed to load event");
        const parsed = eventResponseSchema.parse(await res.json());
        return { status: "ok" as const, event: parsed.event, warnings: parsed.warnings };
      })
      .then((next) => {
        if (active) setState(next);
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  /**
   * `DELETE` is the only door into `cancelled` — cancelling must also release the
   * unspent allocation, and a second route in is how that release gets skipped.
   */
  const cancelEvent = useCallback(async () => {
    if (!id) return false;
    setBusy(true);
    setMutationError(undefined);
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE", credentials: "include" });
      // 204 No Content — there is no body to parse.
      if (!res.ok) throw new Error("Failed to cancel the event");
      setState((previous) =>
        previous.status === "ok"
          ? { ...previous, event: { ...previous.event, status: "cancelled" } }
          : previous,
      );
      return true;
    } catch (cause: unknown) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to cancel the event");
      return false;
    } finally {
      setBusy(false);
    }
  }, [id]);

  return { state, cancelEvent, busy, mutationError };
}
