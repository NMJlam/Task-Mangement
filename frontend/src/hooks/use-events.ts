import { listEventsResponseSchema, type EventSummary } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

export type EventsQuery = {
  teamId?: string;
  status?: string;
  from?: string;
  to?: string;
  ownerId?: string;
  /**
   * Direction of the keyset read. `asc` is what "soonest first" means over a
   * capped page: sorting the returned rows on the client would only reorder the
   * ones that page happens to hold, and the soonest event of all could be the
   * one the limit dropped.
   */
  order?: "asc" | "desc";
};

type EventsState =
  | { status: "loading" }
  | { status: "ok"; items: EventSummary[]; nextCursor: string | null }
  | { status: "error"; message: string };

/** `cursor` is opaque — base64 of `startsAt|id`. Pass `nextCursor` back verbatim. */
function toSearch(query: EventsQuery, cursor?: string) {
  const params = new URLSearchParams();
  if (query.teamId) params.set("teamId", query.teamId);
  if (query.status) params.set("status", query.status);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.ownerId) params.set("ownerId", query.ownerId);
  if (query.order) params.set("order", query.order);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/**
 * ViewModel for the event list (R9). Owns the fetch + parse against the shared
 * schema and exposes plain state to the view — `routes/events.tsx` stays
 * declarative.
 *
 * Filtering is server-side. The API sorts `startsAt DESC`, so splitting the page
 * into upcoming/past on the client would show groups that stay partial until the
 * reader pages all the way to the bottom; `from`/`to` let the server answer the
 * question instead.
 *
 * `enabled: false` keeps the hook idle while still reporting "loading" — the
 * same contract `useTasks` has. A filter that depends on the caller's own
 * identity (the events page's "My Events") must not fall back to the unfiltered
 * list while that identity is unresolved: the unfiltered list answers a
 * different question, and nothing on screen would say so.
 */
export function useEvents(query: EventsQuery = {}, { enabled = true }: { enabled?: boolean } = {}) {
  const { teamId, status, from, to, ownerId, order } = query;
  const [state, setState] = useState<EventsState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    if (!enabled) {
      setState({ status: "loading" });
      setMutationError(undefined);
      return;
    }

    let active = true;
    setState({ status: "loading" });

    fetch(`/api/events${toSearch({ teamId, status, from, to, ownerId, order })}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load events");
        return listEventsResponseSchema.parse(await res.json());
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
  }, [enabled, teamId, status, from, to, ownerId, order]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ok" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMutationError(undefined);
    try {
      const search = toSearch({ teamId, status, from, to, ownerId, order }, state.nextCursor);
      const res = await fetch(`/api/events${search}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load more events");
      const parsed = listEventsResponseSchema.parse(await res.json());
      setState((previous) =>
        previous.status === "ok"
          ? {
              status: "ok",
              items: [...previous.items, ...parsed.items],
              nextCursor: parsed.nextCursor,
            }
          : previous,
      );
    } catch (cause: unknown) {
      setMutationError(cause instanceof Error ? cause.message : "Failed to load more events");
    } finally {
      setLoadingMore(false);
    }
  }, [state, loadingMore, teamId, status, from, to, ownerId, order]);

  // Creating an event lives on `/events/new` (`useCreateEvent`), which validates
  // the full `createEventSchema` before posting. This hook stays read-only.
  return { state, loadMore, loadingMore, mutationError };
}
