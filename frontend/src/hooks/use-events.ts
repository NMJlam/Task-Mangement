import { listEventsResponseSchema, type EventSummary } from "@ctp/shared";
import { useEffect, useState } from "react";

type EventsState =
  | { status: "loading" }
  | { status: "ok"; items: EventSummary[]; nextCursor: string | null }
  | { status: "error"; message: string };

/**
 * ViewModel for the event list (R9). Owns the fetch + parse against the
 * shared schema and exposes plain state to the view — `routes/events.tsx`
 * stays declarative. No pagination wiring yet (Phase 6 scope is the list
 * route itself); `nextCursor` is exposed for a future "load more".
 */
export function useEvents(query: { teamId?: string; status?: string } = {}): EventsState {
  const { teamId, status } = query;
  const [state, setState] = useState<EventsState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    const params = new URLSearchParams();
    if (teamId) params.set("teamId", teamId);
    if (status) params.set("status", status);
    const qs = params.toString();

    fetch(`/api/events${qs ? `?${qs}` : ""}`, { credentials: "include" })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) throw new Error("Failed to load events");
        return listEventsResponseSchema.parse(body);
      })
      .then((parsed) => {
        if (active) setState({ status: "ok", items: parsed.items, nextCursor: parsed.nextCursor });
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
  }, [teamId, status]);

  return state;
}
