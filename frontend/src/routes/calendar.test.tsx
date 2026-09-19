import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { CalendarPage } from "./calendar";

/**
 * Stands in for the drag provider, exactly as the task-board tests do: jsdom has
 * no layout, so dnd-kit's collision detection can never report a drop here. The
 * page still owns the decision — this only hands it the operation a real drop
 * would produce.
 */
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => {
    dnd.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  useDraggable: () => ({ ref: () => {}, handleRef: () => {}, isDragging: false }),
  useDroppable: () => ({ ref: () => {}, isDropTarget: false }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000001";
/** The signed-in member, as `/api/me` reports it. */
const ME_ID = "018f3a4b-0000-7000-8000-00000000000f";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
/** The picker's own trigger format: date and time, so a time change is visible. */
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
/** The preview's format, from `dateTime`. */
const fullStamp = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
/** The page's own long date, used for day headings and cell labels. */
const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
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
  ownerId: null as string | null,
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
function detail(item: { id: string; title: string; status: string; ownerId: string | null }) {
  return {
    event: {
      id: item.id,
      title: item.title,
      status: item.status,
      startsAt: showcase.startsAt.toISOString(),
      endsAt: showcase.endsAt.toISOString(),
      venue: "Macquarie Theatre",
      minTier: 0,
      owner: item.ownerId ? { id: item.ownerId, name: "Ada Lovelace" } : null,
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

/** What the page's `PATCH /api/events/:id` writes. */
function patchBodies(fetchMock: Mock) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

/**
 * A calendar stub plus the two endpoints the page reads around it. The events
 * range read comes back as `items`; deciding which day that puts an event on is
 * the page's job, so nothing here pre-computes it.
 */
function stubFetch(
  items: unknown[],
  {
    tier = 0,
    moveRefused = false,
    moveWarnings = [] as string[],
  }: { tier?: number; moveRefused?: boolean; moveWarnings?: string[] } = {},
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/calendar")) return Promise.resolve(ok({ items }));
    if (url === "/api/me") {
      return Promise.resolve(
        ok({ user: { id: ME_ID, email: "me@example.com", role: "officer", tier } }),
      );
    }
    if (init?.method === "PATCH") {
      if (moveRefused) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({
            error: { code: "FORBIDDEN", message: "Only the owner or lead+ can edit this event." },
          }),
        });
      }
      // Echoed the way the route returns it: the STORED row, so a caller that
      // trusts its own draft instead of this response is caught here.
      const patch = JSON.parse(String(init.body)) as { startsAt: string; endsAt: string | null };
      return Promise.resolve(
        ok({
          event: { ...detail(showcase).event, ...patch },
          ...(moveWarnings.length > 0 ? { warnings: moveWarnings } : {}),
        }),
      );
    }
    if (url.startsWith("/api/events/")) {
      return Promise.resolve(ok(detail({ ...showcase, ownerId: showcase.ownerId })));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The local calendar day as `YYYY-MM-DD`, which is what the page sends. */
function toIso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function renderPage(initialPath = "/calendar") {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CalendarPage />
      {/* The URL is the view state, so a test has to be able to read it — and to
          walk it, which is the point of Back/Forward restoring a range. */}
      <UrlProbe />
    </MemoryRouter>,
  );
}

function UrlProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="calendar-url">{location.pathname + location.search}</p>
      <button type="button" data-testid="calendar-back" onClick={() => void navigate(-1)}>
        Browser back
      </button>
      <button type="button" data-testid="calendar-forward" onClick={() => void navigate(1)}>
        Browser forward
      </button>
    </>
  );
}

/**
 * The cell index of the chip's day, read off the rendered grid rather than
 * recomputed: the drop target's id IS the cell's position, and deriving it the
 * way the page does would test the test's copy of the grid arithmetic.
 *
 * Selected by the CHIP, not by "any cell with a button": every day cell now
 * carries its own "show this day" button, so a button-matched cell would be the
 * first cell of the grid whatever event the test placed.
 */
function cellIndex(root: HTMLElement): number {
  const cells = [...root.querySelectorAll("main tbody td")];
  const cell = root.querySelector('main tbody td:has(button[aria-label^="Open "])');
  const index = cells.indexOf(cell as HTMLTableCellElement);
  if (index < 0) throw new Error("The chip is not inside a day cell");
  return index;
}

function drop(fromIndex: number, toIndex: number) {
  act(() => {
    dnd.onDragEnd?.({
      canceled: false,
      operation: {
        source: {
          id: `${EVENT_ID}:${fromIndex}`,
          data: { id: EVENT_ID, dayIndex: fromIndex, title: "Winter Showcase" },
        },
        target: { id: String(toIndex) },
      },
    });
  });
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
      name: /^open winter showcase/i,
    });
    expect(openButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      `Open Winter Showcase, Planning, on ${dateFormat.format(at(0))}`,
      `Open Winter Showcase, Planning, on ${dateFormat.format(at(0, 1))}`,
      `Open Winter Showcase, Planning, on ${dateFormat.format(at(0, 2))}`,
    ]);

    // The start time belongs to the first day; the other two read as
    // continuations of the same single start.
    expect(screen.getByText(timeFormat.format(at(22)))).toBeInTheDocument();
    expect(screen.getAllByText("Continues")).toHaveLength(2);
  });

  it("moves an event by whole days when its chip is dropped on another day", async () => {
    const fetchMock = stubFetch([showcase], { tier: 1 });
    const { container } = renderPage();
    const chip = await screen.findByRole("button", { name: /^open winter showcase/i });
    const from = cellIndex(container);
    const target = at(0, 2);

    drop(from, from + 2);

    // The same PATCH the event page writes, with the time of day preserved and
    // the end moved by the same two days.
    await waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual([
        {
          startsAt: at(10, 2).toISOString(),
          endsAt: at(13, 2).toISOString(),
        },
      ]),
    );
    // And the chip is on the new day straight away, without waiting for a read.
    expect(
      screen.getByRole("button", {
        name: `Open Winter Showcase, Planning, on ${dateFormat.format(target)}`,
      }),
    ).toBeInTheDocument();
    expect(chip).not.toBeInTheDocument();
  });

  it("reports the tasks a move left behind", async () => {
    // The route warns rather than moving task deadlines itself, so a drop that
    // strands them has to say so — a silently inconsistent board is worse.
    stubFetch([showcase], { tier: 1, moveWarnings: ["2 tasks now fall after the event date"] });
    const { container } = renderPage();
    await screen.findByRole("button", { name: /^open winter showcase/i });

    drop(cellIndex(container), cellIndex(container) + 1);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 tasks now fall after the event date",
    );
  });

  it("writes nothing for a drop on the same day, or one outside a day", async () => {
    const fetchMock = stubFetch([showcase], { tier: 1 });
    const { container } = renderPage();
    await screen.findByRole("button", { name: /^open winter showcase/i });
    const from = cellIndex(container);

    drop(from, from);
    act(() => {
      dnd.onDragEnd?.({ canceled: true, operation: { source: { data: {} }, target: null } });
    });
    act(() => {
      dnd.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: `${EVENT_ID}:${from}`, data: { id: EVENT_ID, dayIndex: from } },
          target: null,
        },
      });
    });

    expect(patchBodies(fetchMock)).toEqual([]);
  });

  it("puts the chip back and says why when the move is refused", async () => {
    const fetchMock = stubFetch([showcase], { tier: 1, moveRefused: true });
    const { container } = renderPage();
    await screen.findByRole("button", { name: /^open winter showcase/i });
    const from = cellIndex(container);

    drop(from, from + 1);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only the owner or lead+ can edit this event.",
    );
    // Reverted: the event is back on the day it started on.
    expect(
      screen.getByRole("button", {
        name: `Open Winter Showcase, Planning, on ${dateFormat.format(at(0))}`,
      }),
    ).toBeInTheDocument();
    expect(patchBodies(fetchMock)).toHaveLength(1);
  });

  // Two controls per chip, deliberately separate: the body opens the preview,
  // the grip is the only drag activator — the same split as a task card.
  it("offers the drag grip only for events the caller may edit", async () => {
    stubFetch([showcase], { tier: 0 });
    const { unmount } = renderPage();
    await screen.findByRole("button", { name: /^open winter showcase/i });

    // Tier 0 and not the owner: the route would refuse the PATCH.
    expect(
      screen.queryByRole("button", { name: /^move winter showcase from/i }),
    ).not.toBeInTheDocument();

    unmount();
    stubFetch([{ ...showcase, ownerId: ME_ID }], { tier: 0 });
    renderPage();
    await screen.findByRole("button", { name: /^open winter showcase/i });

    // Owning it is the other half of the same rule.
    expect(screen.getByRole("button", { name: /^move winter showcase from/i })).toBeInTheDocument();
  });

  it("opens an event's overview and links on to the full event page", async () => {
    const user = userEvent.setup();
    stubFetch([showcase]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^open winter showcase/i }));

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

  it("reschedules from the preview through the same visual picker", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase], { tier: 1 });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^open winter showcase/i }));
    const preview = await screen.findByRole("dialog");
    await user.click(within(preview).getByRole("button", { name: "Edit dates" }));

    const form = await screen.findAllByRole("dialog").then((dialogs) => dialogs.at(-1)!);
    expect(within(form).getByRole("heading", { name: "Edit dates" })).toBeInTheDocument();
    // The start is pre-filled from what is stored, and cannot be cleared.
    expect(within(form).getByLabelText("Start date")).toHaveTextContent(
      dateFormat.format(showcase.startsAt),
    );
    expect(within(form).queryByRole("button", { name: /^clear start/i })).not.toBeInTheDocument();

    await user.click(within(form).getByLabelText("Start date"));
    const picker = await screen.findByRole("dialog", { name: "Pick the start date" });
    await pick(picker, at(0, 3), "Start time", "18:00");

    // The chosen instant lands on the trigger, and the end followed it keeping
    // the three hours the event already ran for — one gesture, not an invalid
    // range to untangle.
    await waitFor(() =>
      expect(within(form).getByLabelText("Start date")).toHaveTextContent(stamp.format(at(18, 3))),
    );
    expect(within(form).getByLabelText("End date")).toHaveTextContent(stamp.format(at(21, 3)));

    await user.click(within(form).getByRole("button", { name: "Save dates" }));

    await waitFor(() =>
      expect(patchBodies(fetchMock)).toEqual([
        { startsAt: at(18, 3).toISOString(), endsAt: at(21, 3).toISOString() },
      ]),
    );
    // And the preview behind the form now shows what was stored — not the dates
    // it opened with.
    await waitFor(() => expect(preview).toHaveTextContent(fullStamp.format(at(18, 3))));
    expect(preview).toHaveTextContent(fullStamp.format(at(21, 3)));
  });

  it("refuses an end before the start without calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase], { tier: 1 });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^open winter showcase/i }));
    const preview = await screen.findByRole("dialog");
    await user.click(within(preview).getByRole("button", { name: "Edit dates" }));
    const form = await screen.findAllByRole("dialog").then((dialogs) => dialogs.at(-1)!);

    // The end is the field that can be left behind: pulled before the start, the
    // pair is invalid and the route would 422 anyway.
    await user.click(within(form).getByLabelText("End date"));
    const picker = await screen.findByRole("dialog", { name: "Pick the end date" });
    await pick(picker, null, "End time", "09:00");

    expect(within(form).getByRole("alert")).toHaveTextContent(
      "The end must not precede the start.",
    );
    expect(within(form).getByRole("button", { name: "Save dates" })).toBeDisabled();
    expect(patchBodies(fetchMock)).toEqual([]);
  });

  it("closes the overview on Escape and gives focus back to the event button", async () => {
    const user = userEvent.setup();
    stubFetch([showcase]);
    renderPage();

    const opener = await screen.findByRole("button", { name: /^open winter showcase/i });
    await user.click(opener);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Radix restores focus to a `DialogTrigger`; these open from state, so the
    // dialog hands it back explicitly. Without that the user lands on `<body>`
    // and has to tab in from the top of the page.
    expect(screen.getByRole("button", { name: /^open winter showcase/i })).toHaveFocus();
  });

  it("keeps every empty day in the grid and announces it", async () => {
    stubFetch([showcase]);
    renderPage();

    await waitFor(() => expect(screen.getByText("Winter Showcase")).toBeInTheDocument());
    // Six rows of days: every day but the event's own is empty, and each of those
    // cells still renders rather than the grid collapsing to the days with work.
    expect(screen.getAllByText("No events")).toHaveLength(41);
  });

  it("takes the view and the anchor from the URL, and steps them through it", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase]);
    // A Monday: the Sunday-first week around it starts on the 11th.
    renderPage("/calendar?view=week&date=2026-10-12");

    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(1));
    expect(spanInDays(lastCalendarRequest(fetchMock))).toBe(7);
    expect(toIso(new Date(lastCalendarRequest(fetchMock).searchParams.get("from")!))).toBe(
      "2026-10-11",
    );
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(2));
    expect(toIso(new Date(lastCalendarRequest(fetchMock).searchParams.get("from")!))).toBe(
      "2026-10-18",
    );
    // The address follows the range, so the view is copyable and recoverable.
    expect(screen.getByTestId("calendar-url")).toHaveTextContent("view=week&date=2026-10-19");

    // Today drops the date key entirely — it is the default, and a URL that says
    // it twice is a URL that can disagree with itself.
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(3));
    expect(screen.getByTestId("calendar-url")).not.toHaveTextContent("date=");
    expect(endpoint(lastCalendarRequest(fetchMock)).to.getTime()).toBeGreaterThanOrEqual(
      startOfToday().getTime(),
    );
  });

  it("restores the previous range on Back, and the next one on Forward", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase]);
    renderPage("/calendar");

    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(1));
    const first = lastCalendarRequest(fetchMock).toString();
    const firstLabel = screen
      .getByRole("heading", { name: "Calendar" })
      .closest("header")!.textContent;

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(2));
    const stepped = lastCalendarRequest(fetchMock).toString();
    expect(stepped).not.toBe(first);

    await user.click(screen.getByTestId("calendar-back"));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(3));
    // The SAME range, not merely a range: the request body and the visible
    // period both come back.
    expect(lastCalendarRequest(fetchMock).toString()).toBe(first);
    expect(screen.getByRole("heading", { name: "Calendar" }).closest("header")!.textContent).toBe(
      firstLabel,
    );

    await user.click(screen.getByTestId("calendar-forward"));
    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(4));
    expect(lastCalendarRequest(fetchMock).toString()).toBe(stepped);
  });

  it("opens the day view from a day cell's own button", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([showcase]);
    renderPage();

    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(1));
    // Every cell carries its date in its own accessible name, which is also what
    // makes the day reachable without a drag.
    const target = at(0, 4);
    await user.click(screen.getByRole("button", { name: `Show ${fullDate.format(target)}` }));

    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(2));
    expect(spanInDays(lastCalendarRequest(fetchMock))).toBe(1);
    expect(toIso(new Date(lastCalendarRequest(fetchMock).searchParams.get("from")!))).toBe(
      toIso(target),
    );
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { level: 2, name: fullDate.format(target) }),
    ).toBeInTheDocument();
  });

  it("jumps to a typed date, and ignores one that does not exist", async () => {
    const fetchMock = stubFetch([showcase]);
    renderPage();

    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(1));
    const field = screen.getByLabelText("Jump to date");
    fireEvent.change(field, { target: { value: "2026-03-15" } });

    await waitFor(() => expect(calendarRequests(fetchMock)).toHaveLength(2));
    const jumped = endpoint(lastCalendarRequest(fetchMock));
    expect(jumped.from.getTime()).toBeLessThanOrEqual(new Date(2026, 2, 15).getTime());
    expect(jumped.to.getTime()).toBeGreaterThanOrEqual(new Date(2026, 2, 15).getTime());

    // Feb 30 is not a date. The field reports it, and the range stays put rather
    // than being rolled over into March.
    fireEvent.change(screen.getByLabelText("Jump to date"), { target: { value: "2026-02-30" } });
    expect(calendarRequests(fetchMock)).toHaveLength(2);
  });

  it("recovers a failed range with Try Again instead of a page refresh", async () => {
    const user = userEvent.setup();
    let failed = true;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/calendar")) {
        if (failed) {
          failed = false;
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        return Promise.resolve(ok({ items: [showcase] }));
      }
      if (url === "/api/me") {
        return Promise.resolve(
          ok({ user: { id: ME_ID, email: "me@example.com", role: "officer", tier: 0 } }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the calendar");

    await user.click(screen.getByRole("button", { name: "Try Again" }));

    expect(await screen.findByText("Winter Showcase")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calendarRequests(fetchMock)).toHaveLength(2);
  });

  it("offers New Event to leads, seeded with the day on screen", async () => {
    stubFetch([showcase], { tier: 1 });
    renderPage("/calendar?date=2026-10-12");

    const link = await screen.findByRole("link", { name: "New Event" });
    await waitFor(() => expect(link).toHaveAttribute("href", "/events/new?date=2026-10-12"));
  });

  it("hides New Event from tier 0, where the route would bounce them", async () => {
    stubFetch([showcase], { tier: 0 });
    renderPage();

    await waitFor(() => expect(screen.getByText("Winter Showcase")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "New Event" })).not.toBeInTheDocument();
  });

  it("names each chip's status, which is otherwise carried by colour alone", async () => {
    stubFetch([{ ...showcase, status: "live" }]);
    renderPage();

    expect(
      await screen.findByRole("button", {
        name: `Open Winter Showcase, Live, on ${dateFormat.format(at(0))}`,
      }),
    ).toBeInTheDocument();
  });
});

/**
 * Works one open date popover the way a user does: optionally click a day, always
 * retype the native time field (it opens holding the stored value), then Apply.
 * `day: null` keeps the day the popover opened on.
 */
async function pick(popover: HTMLElement, day: Date | null, timeLabel: string, time: string) {
  const user = userEvent.setup();
  if (day) {
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const cell = document.querySelector(`[data-day="${iso}"]`);
    if (!cell) throw new Error(`No calendar cell for ${iso}`);
    await user.click(within(cell as HTMLElement).getByRole("button"));
  }
  const field = within(popover).getByLabelText(timeLabel);
  await user.clear(field);
  await user.type(field, time);
  await user.click(within(popover).getByRole("button", { name: "Apply" }));
}
