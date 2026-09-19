import { type CalendarItem, type EventDetail } from "@ctp/shared";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCalendar } from "@/hooks/use-calendar";
import { useEvent } from "@/hooks/use-event";
import { addDays, lastInstant, sameDay, startOfDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

type View = "day" | "week" | "month";

/**
 * An event as `GET /api/calendar` returns it. Not interchangeable with
 * `EventSummary`: the range read carries no task counts or budget, which is why
 * opening a preview fetches the full detail.
 */
type CalendarEvent = Extract<CalendarItem, { kind: "event" }>;

const viewLabels: Record<View, string> = { day: "Day", week: "Week", month: "Month" };

const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const mediumDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const shortWeekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayNumber = new Intl.DateTimeFormat(undefined, { day: "numeric" });
const cellDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

/** Sunday-first, matching the grid's column order. */
function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -day.getDay());
}

/** 42 days: six Sunday-first rows, so the grid never changes height. */
const MONTH_ROWS = 6;
const MONTH_CELLS = MONTH_ROWS * 7;

/** The seven weekday names, taken from a real Sunday-first week. */
const weekdayHeaders = Array.from({ length: 7 }, (_, index) =>
  shortWeekday.format(addDays(startOfWeek(new Date()), index)),
);

/** The dates one view shows, and the instant range they cover. */
function rangeFor(view: View, anchor: Date): { days: Date[]; from: Date; to: Date } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { days: [from], from, to: lastInstant(from, 1) };
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    return {
      days: Array.from({ length: 7 }, (_, index) => addDays(from, index)),
      from,
      to: lastInstant(from, 7),
    };
  }
  // The Sunday on or before the 1st: the top-left cell of the grid.
  const from = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return {
    days: Array.from({ length: MONTH_CELLS }, (_, index) => addDays(from, index)),
    from,
    to: lastInstant(from, MONTH_CELLS),
  };
}

/**
 * The events occupying `day`, in start order.
 *
 * Tests each event's own span against the day's bounds rather than walking its
 * days and emitting into a map: a data-entry slip (a decade-long `endsAt`) would
 * make the walk unbounded, whereas this is at most `days × events` comparisons of
 * a page-sized list.
 */
function eventsOn(day: Date, events: readonly CalendarEvent[]): CalendarEvent[] {
  const start = day.getTime();
  const end = lastInstant(day, 1).getTime();
  return events.filter((event) => {
    const from = event.startsAt.getTime();
    const to = (event.endsAt ?? event.startsAt).getTime();
    return from <= end && to >= start;
  });
}

function rangeLabel(view: View, days: Date[], anchor: Date): string {
  if (view === "day") return fullDate.format(days[0]!);
  if (view === "week") {
    return `${mediumDate.format(days[0]!)} – ${mediumDate.format(days[6]!)}`;
  }
  // The anchor's month, NOT the grid's first day: the grid opens in the previous
  // month whenever the 1st is not a Sunday, and the label names what is shown.
  return monthYear.format(anchor);
}

/** The calendar (R6) as a day, week or month grid of events. */
export function CalendarPage() {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  // The open preview, by id: the dialog fetches that event's full detail.
  const [openId, setOpenId] = useState<string>();
  // Radix hands focus back to a `DialogTrigger`, and no trigger exists here
  // because these buttons live in the grid — so the button that opened the
  // dialog is remembered instead, and focused again on close. Without it a
  // keyboard user returns to the top of the document, having lost the day.
  const opener = useRef<HTMLElement | null>(null);
  const { days, from, to } = rangeFor(view, anchor);
  const calendar = useCalendar(from, to);
  const events =
    calendar.state.status === "ok"
      ? calendar.state.items.filter((item): item is CalendarEvent => item.kind === "event")
      : [];

  function openEvent(id: string, trigger: HTMLElement) {
    opener.current = trigger;
    setOpenId(id);
  }

  function step(direction: -1 | 1) {
    if (view === "day") setAnchor(addDays(anchor, direction));
    else if (view === "week") setAnchor(addDays(anchor, direction * 7));
    // The 1st, so stepping from the 31st does not skip a short month.
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader title="Calendar" description={rangeLabel(view, days, anchor)} />

      <Tabs
        value={view}
        // Radix unmounts the inactive panel, so the switch also decides which
        // grid renders — one surface at a time, not three hidden ones.
        onValueChange={(next) => setView(next as View)}
        className="mt-6 gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Calendar view">
            {(["day", "week", "month"] as const).map((option) => (
              <TabsTrigger key={option} value={option}>
                {viewLabels[option]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`Previous ${view}`}
              onClick={() => step(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`Next ${view}`}
              onClick={() => step(1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        {calendar.state.status === "loading" && (
          <p className="text-sm text-muted-foreground" role="status">
            Loading the Calendar…
          </p>
        )}
        {calendar.state.status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            Couldn&apos;t load the calendar: {calendar.state.message}. Refresh the page to try
            again.
          </p>
        )}

        {calendar.state.status === "ok" && (
          <>
            <TabsContent value="day">
              <div className="rounded-lg border">
                <DayColumn
                  date={days[0]!}
                  events={eventsOn(days[0]!, events)}
                  onOpen={openEvent}
                  detailed
                />
              </div>
            </TabsContent>

            <TabsContent value="week">
              <div className="overflow-x-auto">
                <WeekGrid days={days} events={events} onOpen={openEvent} />
              </div>
            </TabsContent>

            <TabsContent value="month">
              <div className="overflow-x-auto">
                <MonthGrid days={days} events={events} anchor={anchor} onOpen={openEvent} />
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>

      <EventOverviewDialog id={openId} opener={opener} onClose={() => setOpenId(undefined)} />
    </main>
  );
}

/** The seven weekday headings a week and month grid share. */
function WeekdayHeadings() {
  return (
    <thead>
      <tr>
        {weekdayHeaders.map((label) => (
          <th
            key={label}
            scope="col"
            className="border-b px-2 py-2 text-left text-xs font-medium text-muted-foreground"
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * Seven dated columns. A table rather than nested `role="grid"` divs: the
 * weekday headings then come for free as column headers, instead of every cell
 * needing an `aria-label` that repeats the date a screen reader has already
 * announced.
 */
function WeekGrid({
  days,
  events,
  onOpen,
}: {
  days: Date[];
  events: CalendarEvent[];
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  return (
    // `min-w` inside a scrolling parent: a phone shows two or three days and
    // scrolls, rather than collapsing seven columns into an unreadable agenda.
    <table className="w-full min-w-3xl border-separate border-spacing-0 rounded-lg border">
      <WeekdayHeadings />
      <tbody>
        <tr>
          {days.map((day) => (
            <td key={day.toISOString()} className="w-[14.28%] align-top">
              <DayColumn date={day} events={eventsOn(day, events)} onOpen={onOpen} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** Sunday-first, always six rows, adjacent months included so nothing is hidden. */
function MonthGrid({
  days,
  events,
  anchor,
  onOpen,
}: {
  days: Date[];
  events: CalendarEvent[];
  anchor: Date;
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  return (
    <table className="w-full min-w-4xl border-separate border-spacing-0 rounded-lg border">
      <caption className="sr-only">{monthYear.format(anchor)}</caption>
      <WeekdayHeadings />
      <tbody>
        {Array.from({ length: MONTH_ROWS }, (_, row) => (
          <tr key={row}>
            {days.slice(row * 7, row * 7 + 7).map((day) => (
              <td
                key={day.toISOString()}
                className={cn(
                  "w-[14.28%] align-top",
                  // Days outside the anchor month stay in the grid (they are real
                  // days with real events) and read as secondary by their CELL
                  // tint, never by fading the text: `muted-foreground` is 4.88:1
                  // on the page and 4.71:1 on this tint, but dropping it to 60%
                  // opacity would be 2.38:1 — under AA.
                  day.getMonth() !== anchor.getMonth() && "bg-muted/40",
                )}
              >
                <DayColumn date={day} events={eventsOn(day, events)} onOpen={onOpen} compact />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One dated cell: the date, then the events it holds in start order.
 *
 * Empty days stay rendered and say so, rather than being collapsed away — a gap
 * in a calendar is information.
 */
function DayColumn({
  date,
  events,
  onOpen,
  detailed = false,
  compact = false,
}: {
  date: Date;
  events: CalendarEvent[];
  onOpen: (id: string, trigger: HTMLElement) => void;
  /** Day view: the full date as a heading, and no grid-imposed cell padding. */
  detailed?: boolean;
  /** Month view: a bare day number. */
  compact?: boolean;
}) {
  const isToday = sameDay(date, new Date());

  return (
    <div
      className={cn(
        "grid content-start gap-1 rounded-lg",
        compact ? "min-h-24 p-1.5" : "min-h-20 p-2",
      )}
    >
      <div className={cn("flex items-baseline gap-1.5", detailed && "border-b pb-2")}>
        {detailed ? (
          <h3 className="text-sm font-semibold">{fullDate.format(date)}</h3>
        ) : compact ? (
          <time
            dateTime={date.toISOString()}
            className={cn(
              "text-xs font-medium tabular-nums",
              isToday && "rounded bg-secondary px-1.5 py-0.5",
            )}
          >
            {dayNumber.format(date)}
          </time>
        ) : (
          <time
            dateTime={date.toISOString()}
            className={cn("text-xs font-medium", isToday && "rounded bg-secondary px-1.5 py-0.5")}
          >
            {cellDate.format(date)}
          </time>
        )}
      </div>

      <ul className="grid gap-1">
        {events.map((event) => (
          <li key={event.id}>
            <EventChip event={event} date={date} onOpen={onOpen} />
          </li>
        ))}
      </ul>

      {events.length === 0 &&
        (compact ? (
          // Kept out of the month grid's pixels — six rows of "No events" is
          // noise — but still announced, so the cell is not silently blank.
          <span className="sr-only">No events</span>
        ) : (
          <p className="rounded-md border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
            No events
          </p>
        ))}
    </div>
  );
}

/**
 * One event on one day. A multi-day event renders one chip per day it occupies,
 * so the accessible name carries the day — without it every chip of the same
 * event would be announced identically.
 */
function EventChip({
  event,
  date,
  onOpen,
}: {
  event: CalendarEvent;
  date: Date;
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Open ${event.title} on ${mediumDate.format(date)}`}
      onClick={(click) => onOpen(event.id, click.currentTarget)}
      className="w-full cursor-pointer rounded-md bg-secondary px-1.5 py-0.5 text-left transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="block truncate text-xs font-medium">{event.title}</span>
      {/* The start time only on the day the event starts; later days of a
          multi-day event are continuations of the same single start. */}
      <span className="block truncate text-[0.6875rem] text-secondary-foreground">
        {sameDay(event.startsAt, date) ? clock.format(event.startsAt) : "Continues"}
      </span>
    </button>
  );
}

/**
 * The event overview, opened by id from any event button.
 *
 * `useEvent` is the same ViewModel the full page uses, so loading, not-found and
 * error are the page's own states rather than a second set invented here. The
 * preview stops at the summary: the tabs, task board, thread, files and RSVP
 * content stay on `/events/:id`, one click away through `View full event`.
 */
function EventOverviewDialog({
  id,
  opener,
  onClose,
}: {
  id: string | undefined;
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed on the id so opening a second event remounts the fetch rather
          than showing the previous event's data while the next one loads. */}
      {id && (
        <DialogContent
          size="default"
          className="max-w-4xl"
          // Radix restores focus to a `DialogTrigger` and cancels the scope's own
          // restore; these events open from state instead, so the grid button is
          // focused by hand — otherwise a keyboard user lands back on `<body>`.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <EventOverview key={id} id={id} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function EventOverview({ id }: { id: string }) {
  const { state } = useEvent(id);
  const event = state.status === "ok" ? state.event : undefined;

  return (
    <>
      {state.status === "loading" && (
        <p className="text-sm text-muted-foreground" role="status">
          Loading event…
        </p>
      )}
      {state.status === "not_found" && (
        <p className="text-sm text-muted-foreground" role="alert">
          This event could not be found. It may have been cancelled.
        </p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load the event: {state.message}. Try again.
        </p>
      )}
      {event && <EventOverviewBody event={event} />}
    </>
  );
}

function EventOverviewBody({ event }: { event: EventDetail }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{event.title}</DialogTitle>
        <DialogDescription>
          {dateTime.format(event.startsAt)}
          {event.endsAt ? ` – ${dateTime.format(event.endsAt)}` : ""}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={event.status} />
      </div>

      <dl className="grid gap-3 border-t pt-4 text-sm">
        <Row label="Starts" value={dateTime.format(event.startsAt)} />
        <Row
          label="Ends"
          value={event.endsAt ? dateTime.format(event.endsAt) : "No end time set"}
        />
        <Row label="Venue" value={event.venue ?? "No venue set"} />
        <Row label="Owner" value={event.owner?.name ?? "No owner"} />
        <Row
          label="Expected attendance"
          value={
            event.attendanceEstimate === null ? "Not estimated" : String(event.attendanceEstimate)
          }
        />
        <Row label="Overdue tasks" value={String(event.overdueCount)} />
      </dl>

      <section className="grid gap-2 border-t pt-4">
        <h2 className="text-sm font-medium">Description</h2>
        <p className="text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
          {event.description || "No event description has been added yet."}
        </p>
      </section>

      <section className="grid gap-3 border-t pt-4">
        <h2 className="text-sm font-medium">Delivery progress</h2>
        <EventHealthStrip
          taskCounts={event.taskCounts}
          overdueCount={event.overdueCount}
          budget={event.budget}
        />
        <dl className="grid gap-1.5 text-sm">
          <Row label="Allocated" value={money.format(event.budget.allocationCents / 100)} />
          <Row label="Committed" value={money.format(event.budget.committedCents / 100)} />
          <Row label="Paid" value={money.format(event.budget.spentCents / 100)} />
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button asChild>
          <Link to={`/events/${event.id}`}>
            <CalendarDays aria-hidden="true" />
            View full event
          </Link>
        </Button>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{value}</dd>
    </div>
  );
}
