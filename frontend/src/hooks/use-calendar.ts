import { calendarResponseSchema, eventResponseSchema, type CalendarItem } from "@ctp/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/api-error";
import type { EventDates, EventDatesSave } from "@/lib/event-dates";

type CalendarState =
  | { status: "loading" }
  | { status: "ok"; items: CalendarItem[] }
  | { status: "error"; message: string };

/**
 * ViewModel for the calendar (GET /api/calendar). `from`/`to` are required.
 *
 * `include=events` is fixed, not a parameter: `/calendar` is an events calendar,
 * so its one caller never wants the task union. The task branch stays on the API
 * for other consumers, but there is nothing to configure here.
 *
 * Also owns moving an event: `reschedule` writes the same `PATCH
 * /api/events/:id` the event page uses, applied optimistically because the drop
 * has already moved the chip on screen. It reports its outcome rather than
 * publishing an error of its own — the caller that dispatched the write is the
 * one that knows where to show it (a page-level notice for a drop, the dialog
 * for a form).
 */
export function useCalendar(from: Date, to: Date, teamId?: string) {
  const [state, setState] = useState<CalendarState>({ status: "loading" });
  /** Bumped to re-read the range after a write; the range itself is unchanged. */
  const [generation, setGeneration] = useState(0);
  /**
   * Dates a drop has already applied locally, keyed by event. Held until a read
   * comes back agreeing with them, so the chip never flickers back to where it
   * was while the refetch is in flight.
   */
  const [moved, setMoved] = useState<ReadonlyMap<string, EventDates>>(new Map());
  const [busyId, setBusyId] = useState<string>();

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const rangeKey = `${fromIso}|${toIso}|${teamId ?? ""}`;
  const lastRange = useRef(rangeKey);

  useEffect(() => {
    // A re-read after a write keeps the grid on screen — blanking it to "Loading
    // the Calendar…" would flash on every move. A RANGE change does not: showing
    // the previous month's events under the new month's heading is worse than a
    // moment of loading, so only that case resets.
    const rangeChanged = lastRange.current !== rangeKey;
    lastRange.current = rangeKey;
    setState((current) =>
      rangeChanged || current.status !== "ok" ? { status: "loading" } : current,
    );

    const params = new URLSearchParams({ from: fromIso, to: toIso, include: "events" });
    if (teamId) params.set("teamId", teamId);

    let active = true;
    fetch(`/api/calendar?${params.toString()}`, { credentials: "include" })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) throw new Error("Failed to load the calendar");
        return calendarResponseSchema.parse(body);
      })
      .then((parsed) => {
        if (!active) return;
        setState({ status: "ok", items: parsed.items });
        // The server now agrees with these moves, so the local copies have done
        // their job. Anything it disagrees with stays — the optimistic value is
        // still the one the user asked for.
        setMoved((current) => {
          const next = new Map(current);
          for (const [id, dates] of current) {
            const item = parsed.items.find(
              (candidate) => candidate.kind === "event" && candidate.id === id,
            );
            if (item && sameDates(item, dates)) next.delete(id);
          }
          return next.size === current.size ? current : next;
        });
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
  }, [rangeKey, generation, fromIso, toIso, teamId]);

  /**
   * Re-reads the visible range. Used after a write made through another hook (the
   * preview's own `useEvent`), so the grid picks the change up without the caller
   * having to re-issue a range it already knows.
   */
  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  /**
   * Moves one event to `dates`. Optimistic — the drop already moved the chip —
   * with the previous dates put back if the write is refused (a tier-0 member
   * moving somebody else's event is the case that matters).
   */
  const reschedule = useCallback(async (id: string, dates: EventDates): Promise<EventDatesSave> => {
    setBusyId(id);
    setMoved((current) => new Map(current).set(id, dates));
    // A refused write must put the chip back. Both the HTTP refusal below and a
    // thrown transport error go through here, so neither can leave the grid
    // showing a move the server never took.
    const revert = () =>
      setMoved((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
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
        revert();
        return { ok: false, message: apiErrorMessage(body) ?? "Failed to move the event" };
      }
      // Read for `warnings` only, and tolerantly: the move has already been
      // stored, so a body that does not parse must not be reported as a failure
      // (which would put the chip back on a day the server no longer agrees with).
      const parsed = eventResponseSchema.safeParse(body);
      setGeneration((current) => current + 1);
      return { ok: true, warnings: (parsed.success && parsed.data.warnings) || [] };
    } catch {
      revert();
      return { ok: false, message: "Failed to move the event. Try again." };
    } finally {
      setBusyId(undefined);
    }
  }, []);

  return {
    state: state.status === "ok" ? { ...state, items: withMoved(state.items, moved) } : state,
    busyId,
    reschedule,
    reload,
  };
}

function withMoved(items: CalendarItem[], moved: ReadonlyMap<string, EventDates>): CalendarItem[] {
  if (moved.size === 0) return items;
  return items.map((item) => {
    const optimistic = item.kind === "event" ? moved.get(item.id) : undefined;
    return optimistic ? { ...item, ...optimistic } : item;
  });
}

/** Whether a fetched row already carries these dates. */
function sameDates(item: CalendarItem, dates: EventDates): boolean {
  if (item.kind !== "event") return false;
  return (
    item.startsAt.getTime() === dates.startsAt.getTime() &&
    (item.endsAt?.getTime() ?? null) === (dates.endsAt?.getTime() ?? null)
  );
}
