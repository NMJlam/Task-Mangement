import { eventResponseSchema, listEventsResponseSchema, type EventSummary } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";

export type EventsQuery = {
  teamId?: string;
  status?: string;
  from?: string;
  to?: string;
  ownerId?: string;
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
 */
export function useEvents(query: EventsQuery = {}) {
  const { teamId, status, from, to, ownerId } = query;
  const [state, setState] = useState<EventsState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    fetch(`/api/events${toSearch({ teamId, status, from, to, ownerId })}`, {
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
  }, [teamId, status, from, to, ownerId]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ok" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMutationError(undefined);
    try {
      const search = toSearch({ teamId, status, from, to, ownerId }, state.nextCursor);
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
  }, [state, loadingMore, teamId, status, from, to, ownerId]);

  /**
   * `POST /api/events` is tier 1. Only `title` and `startsAt` are required by
   * `createEventSchema`; the rest of an event is filled in later via `PATCH`.
   */
  const createEvent = useCallback(
    async (input: { title: string; startsAt: string; venue?: string }) => {
      setBusy(true);
      setMutationError(undefined);
      try {
        const res = await fetch("/api/events", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: input.title,
            startsAt: new Date(input.startsAt).toISOString(),
            ...(input.venue ? { venue: input.venue } : {}),
          }),
        });
        if (!res.ok) throw new Error("Failed to create the event");
        const parsed = eventResponseSchema.parse(await res.json());
        setState((previous) =>
          previous.status === "ok"
            ? { ...previous, items: [parsed.event, ...previous.items] }
            : previous,
        );
        return true;
      } catch (cause: unknown) {
        setMutationError(cause instanceof Error ? cause.message : "Failed to create the event");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { state, loadMore, loadingMore, createEvent, busy, mutationError };
}
