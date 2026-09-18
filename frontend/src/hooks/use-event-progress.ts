import { eventProgressSchema, type EventProgress } from "@ctp/shared";
import { useEffect, useState } from "react";

type ProgressState =
  | { status: "loading" }
  | { status: "ok"; progress: EventProgress }
  | { status: "error"; message: string };

/**
 * ViewModel for `GET /api/events/:id/progress`. Kept apart from `useEvent` on
 * purpose: the verdict needs `daysUntil` in the club timezone, which only this
 * endpoint computes, and a second hook leaves the detail fetch's URL alone.
 */
export function useEventProgress(id: string | undefined): ProgressState {
  const [state, setState] = useState<ProgressState>({ status: "loading" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    setState({ status: "loading" });

    fetch(`/api/events/${id}/progress`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load progress");
        return eventProgressSchema.parse(await res.json());
      })
      .then((progress) => {
        if (active) setState({ status: "ok", progress });
      })
      .catch((cause: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : "Failed to load progress",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  return state;
}
