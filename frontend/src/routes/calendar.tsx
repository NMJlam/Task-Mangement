import { type AuthUser, type CalendarItem, type EventDetail } from "@ctp/shared";
import { Accessibility } from "@dnd-kit/dom";
import {
  DragDropProvider,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { CalendarDays, ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge, statusStyles } from "@/components/common/status-badge";
import { EventDatesDialog } from "@/components/events/event-dates-dialog";
import { EventHealthStrip } from "@/components/events/event-health-strip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCalendar } from "@/hooks/use-calendar";
import { useEvent } from "@/hooks/use-event";
import { useMe } from "@/hooks/use-me";
import {
  addDays,
  daysBetween,
  lastInstant,
  parseLocalDate,
  sameDay,
  shiftDays,
  startOfDay,
  toIsoDate,
} from "@/lib/dates";
import type { EventDates } from "@/lib/event-dates";
import { canEditEvent } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type View = "day" | "week" | "month";

/**
 * An event as `GET /api/calendar` returns it. Not interchangeable with
 * `EventSummary`: the range read carries no task counts or budget, which is why
 * opening a preview fetches the full detail.
 */
type CalendarEvent = Extract<CalendarItem, { kind: "event" }>;

const viewLabels: Record<View, string> = { day: "Day", week: "Week", month: "Month" };

/** `view` is optional in the URL, and Month is the view left out. */
function readView(value: string | null): View {
  return value === "day" || value === "week" ? value : "month";
}

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

function titleOf(data: Record<string, unknown> | undefined): string {
  return typeof data?.title === "string" ? data.title : "The event";
}

/** The calendar (R6) as a day, week or month grid of events, drag to reschedule. */
export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = readView(searchParams.get("view"));
  const dateParam = searchParams.get("date");
  // Memoised on the PARAMETER, not on the clock: `rangeFor` and `useCalendar`
  // both key off the range the anchor produces, and a fresh `Date` per render
  // would re-issue the same read forever.
  const anchor = useMemo(() => parseLocalDate(dateParam) ?? startOfDay(new Date()), [dateParam]);
  // The open preview, by id: the dialog fetches that event's full detail.
  const [openId, setOpenId] = useState<string>();
  // What the last write reported — a refusal, or the tasks left behind by a move.
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string }>();
  // Radix hands focus back to a `DialogTrigger`, and no trigger exists here
  // because these buttons live in the grid — so the button that opened the
  // dialog is remembered instead, and focused again on close. Without it a
  // keyboard user returns to the top of the document, having lost the day.
  const opener = useRef<HTMLElement | null>(null);
  const me = useMe();
  const user = me.status === "ok" ? me.user : undefined;
  const { days, from, to } = rangeFor(view, anchor);
  const calendar = useCalendar(from, to);
  const events =
    calendar.state.status === "ok"
      ? calendar.state.items.filter((item): item is CalendarEvent => item.kind === "event")
      : [];

  // A notice belongs to the range that produced it. Stepping to another month
  // must not leave "moved to Tuesday" hanging over a week the move never
  // touched, and a retry that fixes an error has to clear the old message too.
  useEffect(() => {
    setNotice(undefined);
  }, [view, anchor]);

  /** The one write path to the URL: what is shown IS what the address says. */
  function show(nextView: View, nextAnchor: Date) {
    const params = new URLSearchParams();
    if (nextView !== "month") params.set("view", nextView);
    const iso = toIsoDate(nextAnchor);
    if (iso !== toIsoDate(new Date())) params.set("date", iso);
    setSearchParams(params);
  }

  function openEvent(id: string, trigger: HTMLElement) {
    opener.current = trigger;
    setOpenId(id);
  }

  async function moveEvent(id: string, dates: EventDates) {
    const result = await calendar.reschedule(id, dates);
    if (!result.ok) {
      setNotice({ kind: "error", text: result.message });
      return;
    }
    setNotice(
      result.warnings.length > 0 ? { kind: "info", text: result.warnings.join(" ") } : undefined,
    );
  }

  function step(direction: -1 | 1) {
    if (view === "day") show(view, addDays(anchor, direction));
    else if (view === "week") show(view, addDays(anchor, direction * 7));
    // The 1st, so stepping from the 31st does not skip a short month.
    else show(view, new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1));
  }

  /** A drop: move the event by the same number of days the chip travelled. */
  function handleDragEnd({ operation, canceled }: DragEndEvent) {
    if (canceled) return;
    const eventId = typeof operation.source?.data?.id === "string" ? operation.source.data.id : "";
    const fromIndex = operation.source?.data?.dayIndex;
    const toIndex = Number(operation.target?.id);
    const dragged = events.find((candidate) => candidate.id === eventId);
    const sourceDay = typeof fromIndex === "number" ? days[fromIndex] : undefined;
    const targetDay = Number.isInteger(toIndex) ? days[toIndex] : undefined;
    if (!dragged || !sourceDay || !targetDay) return;
    // Whole local days between the two cells — the cells are always a whole
    // number of days apart, so this is the shift the event takes.
    const delta = daysBetween(sourceDay, targetDay);
    if (delta === 0) return;
    void moveEvent(dragged.id, {
      startsAt: shiftDays(dragged.startsAt, delta),
      endsAt: dragged.endsAt ? shiftDays(dragged.endsAt, delta) : null,
    });
  }

  /** A readable name for a cell, for the drag announcements. */
  const dayName = (index: unknown) => {
    const day = typeof index === "number" ? days[index] : undefined;
    return day ? mediumDate.format(day) : "another day";
  };
  // The board's idiom: the library's id-only sentences are useless, so only the
  // announcements are replaced. Repeating "Over <day>" while the pointer stays
  // in one cell is noise, hence the last-announced tracker. The target id is
  // normalised to a string first: a drop target's id is a number in the library's
  // type and a string in ours, so an unnormalised comparison would re-announce
  // the same cell on every event.
  const announced = useRef<string | undefined>(undefined);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Calendar"
        description={`${rangeLabel(view, days, anchor)} · Drag an event to another day to move it.`}
        actions={
          // `/events/new` is guarded at minTier 1 — hiding the link keeps a
          // guaranteed bounce off screen. The anchor day travels with it, so
          // "New Event" from a day cell starts on that day.
          user !== undefined &&
          user.tier >= 1 && (
            <Button asChild>
              <Link to={`/events/new?date=${toIsoDate(anchor)}`}>
                <Plus aria-hidden="true" />
                New Event
              </Link>
            </Button>
          )
        }
      />

      <DragDropProvider
        plugins={(defaults) =>
          defaults.map((plugin) =>
            plugin === Accessibility
              ? Accessibility.configure({
                  screenReaderInstructions: {
                    draggable:
                      "Press Space to pick up an event. Use the arrow keys to move it towards another day, holding Shift for bigger steps. Press Space to drop, or Escape to cancel.",
                  },
                  announcements: {
                    dragstart: (event: DragStartEvent) => {
                      const origin = event.operation.source?.data?.dayIndex;
                      announced.current = typeof origin === "number" ? String(origin) : undefined;
                      return `Picked up ${titleOf(event.operation.source?.data)} from ${dayName(origin)}.`;
                    },
                    dragover: (event: DragOverEvent) => {
                      // No target means the pointer is over nothing, which is
                      // not a destination worth naming — and clearing the
                      // tracker is what lets the cell it returns to be
                      // announced again.
                      const target = event.operation.target;
                      const over = target ? String(target.id) : undefined;
                      if (over === announced.current) return undefined;
                      announced.current = over;
                      return over === undefined ? undefined : `Over ${dayName(Number(over))}.`;
                    },
                    dragend: (event: DragEndEvent) => {
                      const title = titleOf(event.operation.source?.data);
                      const from = dayName(event.operation.source?.data?.dayIndex);
                      if (event.canceled) return `Drop cancelled. ${title} stays on ${from}.`;
                      if (!event.operation.target)
                        return `Dropped ${title} outside a day. It stays on ${from}.`;
                      return `Moved ${title} to ${dayName(Number(event.operation.target.id))}.`;
                    },
                  },
                })
              : plugin,
          )
        }
        onDragEnd={handleDragEnd}
      >
        <Tabs
          value={view}
          // Radix unmounts the inactive panel, so the switch also decides which
          // grid renders — one surface at a time, not three hidden ones.
          onValueChange={(next) => show(next as View, anchor)}
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={`Previous ${view}`}
                onClick={() => step(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => show(view, startOfDay(new Date()))}
              >
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
              {/* A native date field rather than a picker component: the browser
                  already ships one with keyboard entry and a locale format, and
                  this is a jump, not a scheduled value. */}
              <Label htmlFor="calendar-date" className="text-sm text-muted-foreground">
                Jump to date
              </Label>
              <input
                id="calendar-date"
                type="date"
                value={toIsoDate(anchor)}
                onChange={(event) => {
                  const next = parseLocalDate(event.target.value);
                  // A half-typed or impossible date (Feb 30) leaves the range
                  // where it was rather than jumping somewhere arbitrary.
                  if (next) show(view, next);
                }}
                className="h-9 cursor-pointer rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          {notice && (
            <p
              className={cn(
                "text-sm",
                notice.kind === "error" ? "text-destructive" : "text-muted-foreground",
              )}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}
          {calendar.state.status === "loading" && (
            <p className="text-sm text-muted-foreground" role="status">
              Loading the Calendar…
            </p>
          )}
          {calendar.state.status === "error" && (
            <div className="flex flex-col items-start gap-2" role="alert">
              <p className="text-sm text-destructive">
                Couldn&apos;t load the calendar: {calendar.state.message}
              </p>
              {/* A retry the reader can act on. "Refresh the page" throws away
                  whatever they had open, and a range read is the one thing this
                  page can simply re-ask for. */}
              <Button variant="outline" size="sm" onClick={calendar.reload}>
                Try Again
              </Button>
            </div>
          )}

          {calendar.state.status === "ok" && (
            <>
              <TabsContent value="day">
                <div className="rounded-lg border">
                  <DayColumn
                    dayIndex={0}
                    date={days[0]!}
                    events={eventsOn(days[0]!, events)}
                    user={user}
                    busyId={calendar.busyId}
                    onOpen={openEvent}
                    onSelectDay={(day) => show("day", day)}
                    detailed
                  />
                </div>
              </TabsContent>

              <TabsContent value="week">
                <div className="overflow-x-auto">
                  <WeekGrid
                    days={days}
                    events={events}
                    user={user}
                    busyId={calendar.busyId}
                    onOpen={openEvent}
                    onSelectDay={(day) => show("day", day)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="month">
                <div className="overflow-x-auto">
                  <MonthGrid
                    days={days}
                    events={events}
                    anchor={anchor}
                    user={user}
                    busyId={calendar.busyId}
                    onOpen={openEvent}
                    onSelectDay={(day) => show("day", day)}
                  />
                </div>
              </TabsContent>
            </>
          )}
        </Tabs>
      </DragDropProvider>

      <EventOverviewDialog
        id={openId}
        opener={opener}
        user={user}
        onRescheduled={calendar.reload}
        onClose={() => setOpenId(undefined)}
      />
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
  user,
  busyId,
  onOpen,
  onSelectDay,
}: {
  days: Date[];
  events: CalendarEvent[];
  user: AuthUser | undefined;
  busyId: string | undefined;
  onOpen: (id: string, trigger: HTMLElement) => void;
  onSelectDay: (day: Date) => void;
}) {
  return (
    // `min-w` inside a scrolling parent: a phone shows two or three days and
    // scrolls, rather than collapsing seven columns into an unreadable agenda.
    <table className="w-full min-w-3xl border-separate border-spacing-0 rounded-lg border">
      <WeekdayHeadings />
      <tbody>
        <tr>
          {days.map((day, index) => (
            <td key={day.toISOString()} className="w-[14.28%] align-top">
              <DayColumn
                dayIndex={index}
                date={day}
                events={eventsOn(day, events)}
                user={user}
                busyId={busyId}
                onOpen={onOpen}
                onSelectDay={onSelectDay}
              />
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
  user,
  busyId,
  onOpen,
  onSelectDay,
}: {
  days: Date[];
  events: CalendarEvent[];
  anchor: Date;
  user: AuthUser | undefined;
  busyId: string | undefined;
  onOpen: (id: string, trigger: HTMLElement) => void;
  onSelectDay: (day: Date) => void;
}) {
  return (
    <table className="w-full min-w-4xl border-separate border-spacing-0 rounded-lg border">
      <caption className="sr-only">{monthYear.format(anchor)}</caption>
      <WeekdayHeadings />
      <tbody>
        {Array.from({ length: MONTH_ROWS }, (_, row) => (
          <tr key={row}>
            {days.slice(row * 7, row * 7 + 7).map((day, column) => (
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
                <DayColumn
                  dayIndex={row * 7 + column}
                  date={day}
                  events={eventsOn(day, events)}
                  user={user}
                  busyId={busyId}
                  onOpen={onOpen}
                  onSelectDay={onSelectDay}
                  compact
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One dated cell: the date, then the events it holds in start order. Also the
 * drop target for a drag — dropping on the cell body, not just on a chip, is how
 * an event reaches a day that is empty.
 *
 * Empty days stay rendered and say so, rather than being collapsed away — a gap
 * in a calendar is information.
 */
function DayColumn({
  dayIndex,
  date,
  events,
  user,
  busyId,
  onOpen,
  onSelectDay,
  detailed = false,
  compact = false,
}: {
  /** Position in the visible range; doubles as this cell's drop-target id. */
  dayIndex: number;
  date: Date;
  events: CalendarEvent[];
  user: AuthUser | undefined;
  busyId: string | undefined;
  onOpen: (id: string, trigger: HTMLElement) => void;
  /** Switches to the day view for this date. */
  onSelectDay: (day: Date) => void;
  /** Day view: the full date as a heading, and no grid-imposed cell padding. */
  detailed?: boolean;
  /** Month view: a bare day number. */
  compact?: boolean;
}) {
  const { ref, isDropTarget } = useDroppable({ id: String(dayIndex), accept: "event" });
  const isToday = sameDay(date, new Date());

  return (
    <div
      ref={ref}
      className={cn(
        "grid content-start gap-1 rounded-lg",
        compact ? "min-h-24 p-1.5" : "min-h-20 p-2",
        isDropTarget && "bg-accent/60 ring-2 ring-ring/40 ring-inset",
      )}
    >
      <div className={cn("flex items-baseline gap-1.5", detailed && "border-b pb-2")}>
        {detailed ? (
          // The day view's own heading: `h2` under the page's `h1`, which is
          // where a screen reader's outline expects the section it names.
          <h2 className="text-sm font-semibold">{fullDate.format(date)}</h2>
        ) : (
          <button
            type="button"
            onClick={() => onSelectDay(date)}
            // A month cell shows a bare number and a week cell "Wed 12"; neither
            // is a date on its own, so the name spells the whole local day out.
            aria-label={`Show ${fullDate.format(date)}`}
            className={cn(
              "cursor-pointer rounded-sm px-1 py-0.5 text-xs font-medium hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              compact && "tabular-nums",
              isToday && "bg-secondary",
            )}
          >
            <time dateTime={date.toISOString()}>
              {compact ? dayNumber.format(date) : cellDate.format(date)}
            </time>
          </button>
        )}
      </div>

      <ul className="grid gap-1">
        {events.map((event) => (
          <li key={event.id}>
            <EventChip
              event={event}
              date={date}
              dayIndex={dayIndex}
              movable={canEditEvent(user, event.ownerId)}
              busy={busyId === event.id}
              onOpen={onOpen}
            />
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
 * One event on one day.
 *
 * Two real controls, deliberately separate — the same split `TaskCard` makes. The
 * title opens the preview; the grip is the only drag activator. Making the whole
 * chip the handle would give Space two meanings at once, and a drag that starts
 * from the grip leaves the body free for the click, Enter and Space that open the
 * dialog.
 *
 * A multi-day event renders one chip per day it occupies, so the draggable id is
 * the PAIR (event, day): two chips of the same event are two elements, and the
 * day half is also what makes "drag Wednesday's strip to Friday" mean two days.
 */
function EventChip({
  event,
  date,
  dayIndex,
  movable,
  busy,
  onOpen,
}: {
  event: CalendarEvent;
  date: Date;
  dayIndex: number;
  /** Owner or lead-and-above — the rule the PATCH route enforces server-side. */
  movable: boolean;
  busy: boolean;
  onOpen: (id: string, trigger: HTMLElement) => void;
}) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `${event.id}:${dayIndex}`,
    type: "event",
    disabled: !movable || busy,
    data: { id: event.id, dayIndex, title: event.title },
  });
  // The same status vocabulary the badge on the event list uses, so a chip and
  // the row behind it cannot disagree about what `live` looks like. Only the
  // chip's own text colours are replaced — the handle inherits them rather than
  // keeping `muted-foreground`, which was checked against `secondary` and not
  // against these tints.
  const status = statusStyles[event.status];

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-start gap-0.5 rounded-md px-1.5 py-0.5 transition-[background-color,opacity] motion-reduce:transition-none",
        status.className,
        // Hover is a ring, not a background swap: replacing the status tint on
        // hover would put the status text on a colour nothing checked it against.
        isDragging ? "opacity-60" : "hover:ring-1 hover:ring-ring/40",
      )}
    >
      <button
        type="button"
        // The day is in the name because a multi-day event renders one button per
        // day it occupies — without it every one of them would be announced
        // identically. The status rides along because the tint is the only other
        // place it appears, and colour is not a label.
        aria-label={`Open ${event.title}, ${status.label}, on ${mediumDate.format(date)}`}
        onClick={(click) => onOpen(event.id, click.currentTarget)}
        className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="block truncate text-xs font-medium">{event.title}</span>
        {/* The start time only on the day the event starts; later days of a
            multi-day event are continuations of the same single start. */}
        <span className="block truncate text-[0.6875rem]">
          {sameDay(event.startsAt, date) ? clock.format(event.startsAt) : "Continues"}
        </span>
      </button>
      {movable && (
        <Button
          ref={handleRef}
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          aria-label={`Move ${event.title} from ${mediumDate.format(date)}`}
          className="size-5 shrink-0 touch-none"
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </div>
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
  user,
  onRescheduled,
  onClose,
}: {
  id: string | undefined;
  opener: RefObject<HTMLElement | null>;
  user: AuthUser | undefined;
  /** The grid re-reads once the preview has written new dates of its own. */
  onRescheduled: () => void;
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
          <EventOverview key={id} id={id} user={user} onRescheduled={onRescheduled} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function EventOverview({
  id,
  user,
  onRescheduled,
}: {
  id: string;
  user: AuthUser | undefined;
  onRescheduled: () => void;
}) {
  const detail = useEvent(id);
  const { state } = detail;
  const [editing, setEditing] = useState(false);
  // A move that leaves task deadlines behind reports it rather than fixing it.
  const [warnings, setWarnings] = useState<string[]>([]);
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
      {event && (
        <EventOverviewBody
          event={event}
          canEdit={canEditEvent(user, event.owner?.id ?? null)}
          onEditDates={() => setEditing(true)}
          warnings={warnings}
        />
      )}

      {/* Nested inside the preview so the dates can be fixed without losing the
          place in the calendar. The write goes through the preview's own
          `useEvent`, not the calendar's optimistic `reschedule`: the dialog is
          about to show the stored row, and only this hook holds it — the grid is
          told separately, and re-reads. */}
      <EventDatesDialog
        event={editing ? event : undefined}
        onClose={() => setEditing(false)}
        onSave={async (dates) => {
          const result = await detail.updateDates(dates);
          if (result.ok) onRescheduled();
          return result;
        }}
        onSaved={setWarnings}
      />
    </>
  );
}

function EventOverviewBody({
  event,
  canEdit,
  onEditDates,
  warnings,
}: {
  event: EventDetail;
  canEdit: boolean;
  onEditDates: () => void;
  warnings: string[];
}) {
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
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEditDates}>
            <CalendarDays aria-hidden="true" />
            Edit dates
          </Button>
        )}
      </div>

      {warnings.length > 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          {warnings.join(" ")}
        </p>
      )}

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
          subject={event.title}
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
