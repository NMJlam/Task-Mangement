import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { CalendarPage } from "./calendar";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000001";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
/** The picker's own trigger format: date and time, so a time change is visible. */
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
/** The preview's format, from `dateTime`. */
const fullStamp = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/**
 * Fixtures sit relative to the real clock, because the page opens on today: a
 * hardcoded date could fall outside the default grid, and the month range
 * assertions would then have nothing to cover.
 */
function at(hours: number, dayOffset = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hours);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const showcase = {
  kind: "event" as const,
  id: EVENT_ID,
  title: "Winter Showcase",
  startsAt: at(10),
  endsAt: at(13),
  status: "planning" as const,
};

/** Every `/api/calendar` request so far, in order. */
function calendarRequests(fetchMock: Mock) {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/calendar"))
    .map((url) => new URL(url, "http://localhost"));
}

function lastCalendarRequest(fetchMock: Mock) {
  const last = calendarRequests(fetchMock).at(-1);
  if (!last) throw new Error("The calendar was never requested");
  return last;
}

/** How many local days the requested window covers. */
function spanInDays(url: URL) {
  const from = new Date(url.searchParams.get("from")!).getTime();
  const to = new Date(url.searchParams.get("to")!).getTime();
  // `to` is the last millisecond of the last day, so the +1 lands on a boundary;
  // rounding absorbs the hour a DST switch adds or removes.
  return Math.round((to - from + 1) / DAY_MS);
}

function endpoint(url: URL) {
  return {
    from: new Date(url.searchParams.get("from")!),
    to: new Date(url.searchParams.get("to")!),
  };
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

/** The full detail the overview dialog reads once an event is opened. */
function detail(item: { id: string; title: string; status: string }) {
  return {
    event: {
      id: item.id,
      title: item.title,
      status: item.status,
      startsAt: showcase.startsAt.toISOString(),
      endsAt: showcase.endsAt.toISOString(),
      venue: "Macquarie Theatre",
      minTier: 0,
      owner: null,
      taskCounts: { todo: 2, inProgress: 1, blocked: 0, done: 1 },
      overdueCount: 1,
      budget: { allocationCents: 100_000, committedCents: 50_000, spentCents: 20_000 },
      description: "The annual showcase.",
      attendanceEstimate: 120,
      createdAt: new Date(2026, 0, 1).toISOString(),
      updatedAt: new Date(2026, 0, 2).toISOString(),
    },
  };
}

/**
 * A calendar stub plus the two endpoints the page reads around it. The events
 * range read comes back as `items`; deciding which day that puts an event on is
 * the page's job, so nothing here pre-computes it.
 */
function stubFetch(items: unknown[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/calendar")) return Promise.resolve(ok({ items }));
    if (url.startsWith("/api/events/")) return Promise.resolve(ok(detail(showcase)));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CalendarPage />
    </MemoryRouter>,
  );
}

describe("CalendarPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for events only, over exactly the days each view shows", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Winter Showcase")).toBeInTheDocument());

    // The header names the anchor month, not the grid's first day — the grid
    // opens in the previous month whenever the 1st is not a Sunday.
    const header = screen.getByRole("heading", { name: "Calendar" }).closest("header")!;
    expect(header).toHaveTextContent(monthYear.format(new Date()));

    // The task union is never requested: this page is an events calendar.
    const month = lastCalendarRequest(fetchMock);
    expect(month.searchParams.getAll("include")).toEqual(["events"]);
    // Six Sunday-first rows, covering the whole anchor month.
    expect(spanInDays(month)).toBe(42);
    const thisMonth = endpoint(month);
    expect(thisMonth.from.getDay()).toBe(0);
    expect(thisMonth.from.getHours()).toBe(0);
    const now = new Date();
    expect(thisMonth.from.getTime()).toBeLessThanOrEqual(
      new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    );
    expect(thisMonth.to.getTime()).toBeGreaterThanOrEqual(
      new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime(),
    );

    await user.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(2));
    const week = endpoint(lastCalendarRequest(fetchMock));
    expect(spanInDays(lastCalendarRequest(fetchMock))).toBe(7);
    // Sunday-first, and the window holds today.
    expect(week.from.getDay()).toBe(0);
    expect(week.from.getTime()).toBeLessThanOrEqual(startOfToday().getTime());
    expect(week.to.getTime()).toBeGreaterThanOrEqual(startOfToday().getTime());

    await user.click(screen.getByRole("tab", { name: "Day" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(3));
    const day = endpoint(lastCalendarRequest(fetchMock));
    expect(spanInDays(lastCalendarRequest(fetchMock))).toBe(1);
    expect(day.from.getTime()).toBe(startOfToday().getTime());
    expect(day.to.getTime()).toBe(
      new Date(
        day.from.getFullYear(),
        day.from.getMonth(),
        day.from.getDate() + 1,
        0,
        0,
        0,
        -1,
      ).getTime(),
    );
  });

  it("steps by a month, a week and a day, and Today returns to the anchor", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase]);
    renderPage();
    await waitFor(() => expect(screen.getByText("Winter Showcase")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(2));
    const nextMonth = endpoint(lastCalendarRequest(fetchMock));
    const firstOfNext = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
    expect(spanInDays(lastCalendarRequest(fetchMock))).toBe(42);
    expect(nextMonth.from.getTime()).toBeLessThanOrEqual(firstOfNext.getTime());
    expect(nextMonth.to.getTime()).toBeGreaterThanOrEqual(firstOfNext.getTime());

    // The anchor follows the month step, so the week then steps on from the 1st.
    const weekAnchor = new Date(firstOfNext.getFullYear(), firstOfNext.getMonth(), 8);
    await user.click(screen.getByRole("tab", { name: "Week" }));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(4));
    const nextWeek = endpoint(lastCalendarRequest(fetchMock));
    expect(nextWeek.from.getDay()).toBe(0);
    expect(nextWeek.from.getTime()).toBeLessThanOrEqual(weekAnchor.getTime());
    expect(nextWeek.to.getTime()).toBeGreaterThanOrEqual(weekAnchor.getTime());

    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(5));
    const back = endpoint(lastCalendarRequest(fetchMock));
    expect(back.from.getDay()).toBe(0);
    expect(back.to.getTime()).toBeGreaterThanOrEqual(startOfToday().getTime());
  });

  it("places a multi-day event on every day it occupies", async () => {
    // Late today through mid-morning two days on: three local days.
    stubFetch([{ ...showcase, startsAt: at(22), endsAt: at(11, 2) }]);
    renderPage();

    const openButtons = await screen.findAllByRole("button", {
      name: /^open winter showcase on/i,
    });
    expect(openButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      `Open Winter Showcase on ${dateFormat.format(at(0))}`,
      `Open Winter Showcase on ${dateFormat.format(at(0, 1))}`,
      `Open Winter Showcase on ${dateFormat.format(at(0, 2))}`,
    ]);

    // The start time belongs to the first day; the other two read as
    // continuations of the same single start.
    expect(screen.getByText(timeFormat.format(at(22)))).toBeInTheDocument();
    expect(screen.getAllByText("Continues")).toHaveLength(2);
  });

  // Two controls per chip, deliberately separate: the body opens the preview,
  // the grip is the only drag activator — the same split as a task card.

  it("opens an event's overview and links on to the full event page", async () => {
    const user = userEvent.setup();
    stubFetch([showcase]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^open winter showcase on/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument();
    // The summary fields come from the full detail read, not the range row.
    expect(within(dialog).getByText("Macquarie Theatre")).toBeInTheDocument();
    expect(within(dialog).getByText("The annual showcase.")).toBeInTheDocument();
    // 1 of the 4 tasks is done; 50% of the $1000 allocation is committed.
    expect(within(dialog).getByText("25% complete")).toBeInTheDocument();
    expect(within(dialog).getByText("1 overdue task")).toBeInTheDocument();
    expect(within(dialog).getByText("50% of budget committed")).toBeInTheDocument();
    expect(within(dialog).getByText("$500.00")).toBeInTheDocument();

    expect(within(dialog).getByRole("link", { name: /view full event/i })).toHaveAttribute(
      "href",
      `/events/${EVENT_ID}`,
    );
  });

  it("closes the overview on Escape and gives focus back to the event button", async () => {
    const user = userEvent.setup();
    stubFetch([showcase]);
    renderPage();

    const opener = await screen.findByRole("button", { name: /^open winter showcase on/i });
    await user.click(opener);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Radix restores focus to a `DialogTrigger`; these open from state, so the
    // dialog hands it back explicitly. Without that the user lands on `<body>`
    // and has to tab in from the top of the page.
    expect(screen.getByRole("button", { name: /^open winter showcase on/i })).toHaveFocus();
  });

  it("keeps every empty day in the grid and announces it", async () => {
    stubFetch([showcase]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Winter Showcase")).toBeInTheDocument());
    // Six rows of days: every day but the event's own is empty, and each of those
    // cells still renders rather than the grid collapsing to the days with work.
    expect(screen.getAllByText("No events")).toHaveLength(41);
  });
});
