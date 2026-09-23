import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import { DashboardPage } from "./dashboard";
import { NotificationsProvider, useNotificationsSource } from "@/hooks/use-notifications";

const memberId = "018f3a4b-0000-7000-8000-000000000001";
const eventId = "018f3a4b-0000-7000-8000-000000000002";

afterEach(() => vi.unstubAllGlobals());

it("summarises the current member’s work and upcoming events", async () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fetchMock = stubFetch({
    tasks: { tasks: [task(tomorrow)] },
    events: { items: [event(tomorrow)], nextCursor: null },
    notifications: { notifications: [], unreadCount: 2 },
    members: { members: [rosterMember()] },
  });

  renderPage();

  await waitFor(() => expect(screen.getByText("Confirm Venue Access")).toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Semester Hackathon" })).toHaveAttribute(
    "href",
    `/events/${eventId}`,
  );
  expect(
    within(screen.getByRole("region", { name: "Overview statistics" })).getByText("2"),
  ).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Jordan Lee open tasks" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  expect(screen.getByRole("progressbar", { name: "Jordan Lee open tasks" })).toHaveAttribute(
    "aria-valuetext",
    "1 open task",
  );
  expect(screen.getByRole("link", { name: "New Event" })).toHaveAttribute("href", "/events/new");
  // The personal widget links on with the filter that produced it.
  expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute(
    "href",
    "/tasks?scope=mine",
  );

  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search Club Workspace" });
  fireEvent.change(within(dialog).getByLabelText("Search Club Workspace"), {
    target: { value: "Semester" },
  });
  // Awaited: the result list is a second render after the keystroke, not part of
  // the one the change event produced.
  expect(await within(dialog).findByRole("link", { name: /semester hackathon/i })).toHaveAttribute(
    "href",
    `/events/${eventId}`,
  );
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it("keeps an activity outage out of the page-level error banner", async () => {
  stubFetch({ notifications: { ok: false, status: 503 } });

  renderPage();

  expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("reads the member’s own tasks by id, and the week’s events in start order", async () => {
  const fetchMock = stubFetch({});

  renderPage();

  await waitFor(() => expect(urls(fetchMock)).toContain(`/api/tasks?assignee=${memberId}`));
  // The club-wide list is a second, separate read: it feeds committee load and
  // ⌘K search, which must not be narrowed to one person.
  expect(urls(fetchMock)).toContain("/api/tasks");

  const events = urls(fetchMock).find((url) => url.startsWith("/api/events"))!;
  const params = new URL(events, "http://localhost").searchParams;
  // Bounded to the widget's own window and ASC, so the cap keeps the soonest
  // events rather than the furthest-future ones.
  expect(params.get("order")).toBe("asc");
  const from = new Date(params.get("from")!);
  const to = new Date(params.get("to")!);
  // The window starts at NOW, not at midnight: an ascending page from midnight
  // is the day's finished events, which pushes the rest of the week off the page.
  expect(Math.abs(from.getTime() - Date.now())).toBeLessThan(60_000);
  expect(Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))).toBe(7);
});

it("shows the member’s own task even when the club-wide page does not contain it", async () => {
  // 50 newer tasks belonging to other people: the page the club-wide read
  // returns is full of work that is not the member's, which is exactly how the
  // old single-read Overview lost their own task.
  const others = Array.from({ length: 50 }, (_, index) =>
    task(new Date("2027-01-01T00:00:00.000Z"), {
      id: `018f3a4b-0000-7000-8000-00000000${String(index).padStart(4, "0")}`,
      title: `Someone else’s task ${index}`,
      assigneeIds: ["018f3a4b-0000-7000-8000-00000000000f"],
    }),
  );
  const mine = Array.from({ length: 7 }, (_, index) =>
    task(new Date("2026-12-0" + (index + 1) + "T00:00:00.000Z"), {
      id: `018f3a4b-0000-7000-8000-0000000a${String(index).padStart(4, "0")}`,
      title: `My task ${index}`,
    }),
  );
  stubFetch({ clubTasks: { tasks: others }, personalTasks: { tasks: mine } });

  renderPage();

  expect(await screen.findByText("My task 0")).toBeInTheDocument();
  expect(screen.queryByText("Someone else’s task 0")).not.toBeInTheDocument();
  // Only the first five are shown, and the widget says how many it left out.
  expect(screen.queryByText("My task 6")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2 more open tasks" })).toHaveAttribute(
    "href",
    "/tasks?scope=mine",
  );
});

it("reports an unavailable personal read instead of claiming zero work", async () => {
  stubFetch({ personalTasks: { ok: false, status: 500 } });

  renderPage();

  const stats = await screen.findByRole("region", { name: "Overview statistics" });
  // The metric shows no value at all: "0 open tasks" is a claim a failed read
  // cannot support.
  expect(within(stats).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("Your tasks are unavailable right now.")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your tasks");
});

it("marks an overdue task in words as well as in colour", async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  stubFetch({ tasks: { tasks: [task(yesterday)] } });

  renderPage();

  await waitFor(() => expect(screen.getByText("Confirm Venue Access")).toBeInTheDocument());
  // The date turning red is not a label: the row carries the word, for anyone
  // who cannot see the colour.
  expect(screen.getByText("Overdue")).toBeInTheDocument();
  const stats = screen.getByRole("region", { name: "Overview statistics" });
  expect(within(stats).getByText("1 overdue")).toBeInTheDocument();
});

/**
 * The notification feed is owned by the shell and consumed through context, so
 * a page that reads it has to be mounted under a provider — the same wiring
 * `RequireAuth` does in the app.
 */
function Harness() {
  const notifications = useNotificationsSource();
  return (
    <NotificationsProvider value={notifications}>
      <DashboardPage />
    </NotificationsProvider>
  );
}

function renderPage() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Harness />
    </MemoryRouter>,
  );
}

function urls(fetchMock: Mock): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

/**
 * Routes the dashboard's six reads by URL, since the page issues two task
 * reads and one events read that a call-order stub could not tell apart.
 */
function stubFetch(
  stubs: Partial<{
    tasks: unknown;
    clubTasks: unknown;
    personalTasks: unknown;
    events: unknown;
    notifications: unknown;
    members: unknown;
    me: unknown;
  }>,
) {
  // One task body answers both reads unless a test says otherwise; the
  // club-versus-personal split has its own test.
  const clubTasks = stubs.clubTasks ?? stubs.tasks ?? { tasks: [] };
  const personalTasks = stubs.personalTasks ?? stubs.tasks ?? { tasks: [] };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/me") return resolve(stubs.me ?? { user: me() });
    if (url.startsWith("/api/tasks?")) return resolve(personalTasks);
    if (url === "/api/tasks") return resolve(clubTasks);
    if (url.startsWith("/api/events")) {
      return resolve(stubs.events ?? { items: [], nextCursor: null });
    }
    // Prefix, not equality: the feed now sends an explicit `?limit=`, which is
    // what tells it whether a full page came back.
    if (url.startsWith("/api/notifications")) {
      return resolve(stubs.notifications ?? { notifications: [], unreadCount: 0 });
    }
    if (url === "/api/members") return resolve(stubs.members ?? { members: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function resolve(body: unknown) {
  if (body && typeof body === "object" && "ok" in body) return Promise.resolve(body);
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

function me() {
  return { id: memberId, email: "jordan@example.com", role: "president", tier: 2 };
}

function rosterMember() {
  return {
    id: memberId,
    name: "Jordan Lee",
    email: "jordan@example.com",
    role: "president",
    tier: 2,
    teamIds: [],
    portfolio: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function task(
  dueAt: Date,
  overrides: { id?: string; title?: string; assigneeIds?: string[] } = {},
) {
  return {
    id: overrides.id ?? "018f3a4b-0000-7000-8000-000000000003",
    eventId,
    teamId: null,
    assigneeIds: overrides.assigneeIds ?? [memberId],
    creator: memberId,
    title: overrides.title ?? "Confirm Venue Access",
    description: null,
    status: "todo",
    priority: "high",
    dueAt: dueAt.toISOString(),
    boardOrder: 0,
    minTier: 0,
    completedAt: null,
    aiRunId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function event(startsAt: Date) {
  return {
    id: eventId,
    title: "Semester Hackathon",
    description: null,
    status: "planning",
    startsAt: startsAt.toISOString(),
    endsAt: null,
    venue: "Great Hall",
    minTier: 0,
    owner: null,
    taskCounts: { todo: 1, inProgress: 0, blocked: 0, done: 0 },
    overdueCount: 0,
    budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
  };
}
