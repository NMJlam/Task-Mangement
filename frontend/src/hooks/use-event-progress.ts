import { eventProgressSchema, type EventProgress } from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type ProgressState =
  | { status: "loading" }
  | { status: "ok"; progress: EventProgress }
  | { status: "error"; message: string };

/**
 * ViewModel for `GET /api/events/:id/progress`. Kept apart from `useEvent` on
 * purpose: the verdict needs `daysUntil` in the club timezone, which only this
 * endpoint computes, and a second hook leaves the detail fetch's URL alone.
 */
export function useEventProgress(id: string | undefined): ProgressState & { reload: () => void } {
  const [state, setState] = useState<ProgressState>({ status: "loading" });
  // A re-read applies only if no later one has begun (see `useEvent`).
  const revision = useRef(0);

  useEffect(() => {
    if (!id) return;
    const mine = ++revision.current;
    setState({ status: "loading" });
    void readProgress(id).then((next) => {
      if (revision.current === mine) setState(next);
    });
    return () => {
      revision.current += 1;
    };
  }, [id]);

  /**
   * Re-reads the verdict in place after the event's tasks change. Quiet, and a
   * failed re-read keeps the verdict on screen rather than replacing it.
   */
  const reload = useCallback(() => {
    if (!id) return;
    const mine = ++revision.current;
    void readProgress(id).then((next) => {
      if (revision.current !== mine) return;
      setState((previous) => (next.status === "ok" || previous.status !== "ok" ? next : previous));
    });
  }, [id]);

  return { ...state, reload };
}

async function readProgress(id: string): Promise<ProgressState> {
  try {
    const res = await fetch(`/api/events/${id}/progress`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load progress");
    return { status: "ok", progress: eventProgressSchema.parse(await res.json()) };
  } catch (cause) {
    return {
      status: "error",
      message: cause instanceof Error ? cause.message : "Failed to load progress",
    };
  }
}
