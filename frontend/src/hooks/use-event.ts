import {
  changeEventStatusResponseSchema,
  eventResponseSchema,
  type EventDetail,
  type EventStatus,
  type UpdateEvent,
} from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/api-error";
import type { EventDates, EventDatesSave } from "@/lib/event-dates";

type EventState =
  | { status: "loading" }
  | { status: "ok"; event: EventDetail; warnings?: string[] }
  | { status: "not_found" }
  | { status: "error"; message: string };

/**
 * The outcome of a status change. A refusal is always a list of sentences: a
 * blocked wrap comes back with the ROUTE's own blockers ("2 pending expenses
 * must be resolved before wrapping"), and an illegal hop or a transport failure
 * is a one-line list of its own. One shape means the caller renders one alert
 * and cannot mistake a blocker for a generic error.
 */
export type EventStatusSave = { ok: true; status: EventStatus } | { ok: false; messages: string[] };

/** One read of the event row. Never throws: a failure is a state, as on load. */
async function readEvent(id: string): Promise<EventState> {
  try {
    // `channel` is asked for by name — `channelId` is absent without it, and the
    // Thread tab has nothing to read. `tasks` is NOT: the Tasks tab reads
    // `/api/tasks?eventId=`, and the summary counts come from this row.
    const res = await fetch(`/api/events/${id}?include=channel`, { credentials: "include" });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) throw new Error("Failed to load event");
    const parsed = eventResponseSchema.parse(await res.json());
    return { status: "ok", event: parsed.event, warnings: parsed.warnings };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** ViewModel for a single event (GET /api/events/:id). */
export function useEvent(id: string | undefined) {
  const [state, setState] = useState<EventState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  // Bumped by every read and every write that lands. A re-read applies only if
  // nothing has happened since it began: a later read supersedes it, and a
  // write's own answer is newer than whatever the read was told.
  const revision = useRef(0);

  useEffect(() => {
    if (!id) return;
    const mine = ++revision.current;
    setState({ status: "loading" });
    void readEvent(id).then((next) => {
      if (revision.current === mine) setState(next);
    });
    return () => {
      // A switch to another event invalidates this one's read.
      revision.current += 1;
    };
  }, [id]);

  /**
   * Re-reads the row in place — the task counts, the overdue count, the budget
   * figures — for a page that has just changed what they count. Quiet: the page
   * stays on screen while it runs, and a re-read that fails keeps the page the
   * reader is using rather than replacing it with an error.
   */
  const reload = useCallback(() => {
    if (!id) return;
    const mine = ++revision.current;
    void readEvent(id).then((next) => {
      if (revision.current !== mine) return;
      setState((previous) =>
        next.status === "ok"
          ? // The warnings belonged to the write that raised them; a re-read
            // carries none, so it must not clear them either.
            { ...next, warnings: previous.status === "ok" ? previous.warnings : undefined }
          : previous.status === "ok"
            ? previous
            : next,
      );
    });
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
      revision.current += 1;
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
   * Every event edit, through the one `PATCH /api/events/:id` the route already
   * exposes — dates, details, allocation and visibility all land here. The
   * response is the full detail, so the page's own state is replaced with what
   * the server stored rather than with the draft.
   *
   * Never throws: a refusal comes back as `{ ok: false }` with the sentence to
   * show (the route's per-field message where there is one). The route's
   * `warnings` ride along on success — a date move can leave task deadlines
   * behind the event, and the route reports it instead of moving them.
   */
  const updateEvent = useCallback(
    async (patch: UpdateEvent): Promise<EventDatesSave> => {
      if (!id) return { ok: false, message: "No event to update." };
      setBusy(true);
      setMutationError(undefined);
      try {
        const response = await fetch(`/api/events/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          // `Date`s serialise to ISO strings, which is the shape
          // `updateEventSchema`'s `z.coerce.date()` reads back.
          body: JSON.stringify(patch),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          return { ok: false, message: apiErrorMessage(body) ?? "Failed to update the event" };
        }
        const parsed = eventResponseSchema.parse(body);
        revision.current += 1;
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

  /** The date dialog's own callback: the same write, narrowed to the two fields. */
  const updateDates = useCallback(
    (dates: EventDates) => updateEvent({ startsAt: dates.startsAt, endsAt: dates.endsAt }),
    [updateEvent],
  );

  /**
   * Moves the event along its lifecycle (`PATCH /api/events/:id/status`).
   *
   * The route re-derives the legal hops itself, so this reports what came back
   * rather than predicting it: on success the stored status replaces the page's,
   * and on a refusal the server's own sentences are handed to the caller
   * verbatim — a blocked wrap is a filled-in precondition list, not an error the
   * UI should paraphrase.
   */
  const changeStatus = useCallback(
    async (status: EventStatus): Promise<EventStatusSave> => {
      if (!id) return { ok: false, messages: ["No event to update."] };
      setBusy(true);
      setMutationError(undefined);
      try {
        const response = await fetch(`/api/events/${id}/status`, {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const parsed = changeEventStatusResponseSchema.parse(body);
          revision.current += 1;
          setState((previous) =>
            previous.status === "ok"
              ? {
                  ...previous,
                  event: { ...previous.event, status: parsed.status },
                  // The warnings belonged to the previous write; a status change
                  // is not a date move, so it must not resurrect them.
                  warnings: undefined,
                }
              : previous,
          );
          return { ok: true, status: parsed.status };
        }
        // 409 carries both cases in one body shape: a blocked wrap fills
        // `blockers`, an illegal hop carries a plain ApiError instead.
        const blocked = changeEventStatusResponseSchema.safeParse(body);
        if (blocked.success && blocked.data.blockers.length > 0) {
          return { ok: false, messages: blocked.data.blockers };
        }
        return {
          ok: false,
          messages: [apiErrorMessage(body) ?? "Failed to change the event status."],
        };
      } catch {
        return { ok: false, messages: ["Failed to change the event status. Try again."] };
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  return {
    reload,
    state,
    cancelEvent,
    updateEvent,
    updateDates,
    changeStatus,
    busy,
    mutationError,
  };
}
