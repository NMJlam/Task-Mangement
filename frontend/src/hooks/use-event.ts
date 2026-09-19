import { eventResponseSchema, type EventDetail } from "@ctp/shared";
import { useCallback, useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/api-error";
import type { EventDates, EventDatesSave } from "@/lib/event-dates";

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
    // Thread tab has nothing to read. `tasks` is NOT: the Tasks tab reads
    // `/api/tasks?eventId=`, and the summary counts come from this row.
    fetch(`/api/events/${id}?include=channel`, { credentials: "include" })
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

  /**
   * Rescheduling, through the same `PATCH /api/events/:id` every other event
   * edit uses. The response is the full detail, so the page's own state is
   * replaced with what the server stored rather than with the draft.
   *
   * Never throws: a refusal comes back as `{ ok: false }` with the sentence to
   * show. The route's `warnings` ride along on success — a date move can leave
   * task deadlines behind the event, and the route reports it instead of moving
   * them.
   */
  const updateDates = useCallback(
    async (dates: EventDates): Promise<EventDatesSave> => {
      if (!id) return { ok: false, message: "No event to update." };
      setBusy(true);
      setMutationError(undefined);
      try {
        const response = await fetch(`/api/events/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startsAt: dates.startsAt.toISOString(),
            endsAt: dates.endsAt?.toISOString() ?? null,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          return { ok: false, message: apiErrorMessage(body) ?? "Failed to update the event" };
        }
        const parsed = eventResponseSchema.parse(body);
        setState({ status: "ok", event: parsed.event, warnings: parsed.warnings });
        return { ok: true, warnings: parsed.warnings ?? [] };
      } catch {
        return { ok: false, message: "Failed to update the event. Try again." };
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  return { state, cancelEvent, updateDates, busy, mutationError };
}
