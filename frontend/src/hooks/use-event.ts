import { eventResponseSchema, type EventDetail } from "@ctp/shared";
import { useEffect, useState } from "react";

type EventState =
  | { status: "loading" }
  | { status: "ok"; event: EventDetail; warnings?: string[] }
  | { status: "not_found" }
  | { status: "error"; message: string };

/** ViewModel for a single event (GET /api/events/:id). */
export function useEvent(id: string | undefined): EventState {
  const [state, setState] = useState<EventState>({ status: "loading" });

  useEffect(() => {
    if (!id) return;
    let active = true;
    setState({ status: "loading" });

    fetch(`/api/events/${id}?include=tasks`, { credentials: "include" })
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

  return state;
}
