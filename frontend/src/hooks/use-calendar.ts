import { calendarResponseSchema, type CalendarItem } from "@ctp/shared";
import { useEffect, useState } from "react";

type CalendarState =
  | { status: "loading" }
  | { status: "ok"; items: CalendarItem[] }
  | { status: "error"; message: string };

/** ViewModel for the calendar agenda (GET /api/calendar). `from`/`to` are required. */
export function useCalendar(from: Date, to: Date, teamId?: string): CalendarState {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const [state, setState] = useState<CalendarState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    const params = new URLSearchParams({ from: fromIso, to: toIso });
    if (teamId) params.set("teamId", teamId);

    fetch(`/api/calendar?${params.toString()}`, { credentials: "include" })
      .then(async (res) => {
        const body: unknown = await res.json();
        if (!res.ok) throw new Error("Failed to load the calendar");
        return calendarResponseSchema.parse(body);
      })
      .then((parsed) => {
        if (active) setState({ status: "ok", items: parsed.items });
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
  }, [fromIso, toIso, teamId]);

  return state;
}
