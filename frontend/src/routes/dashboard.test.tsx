import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DashboardPage } from "./dashboard";

const memberId = "018f3a4b-0000-7000-8000-000000000001";
const eventId = "018f3a4b-0000-7000-8000-000000000002";

afterEach(() => vi.unstubAllGlobals());

it("summarises the current member’s work and upcoming events", async () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/me")
      return Promise.resolve(
        response({
          user: { id: memberId, email: "jordan@example.com", role: "president", tier: 2 },
        }),
      );
    if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task(tomorrow)] }));
    if (url === "/api/events")
      return Promise.resolve(response({ items: [event(tomorrow)], nextCursor: null }));
    if (url === "/api/notifications")
      return Promise.resolve(response({ notifications: [], unreadCount: 2 }));
    if (url === "/api/members")
      return Promise.resolve(
        response({
          members: [
            {
              id: memberId,
              name: "Jordan Lee",
              email: "jordan@example.com",
              role: "president",
              tier: 2,
              teamIds: [],
              portfolio: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DashboardPage />
    </MemoryRouter>,
  );

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
  expect(screen.getByRole("link", { name: "New Event" })).toHaveAttribute("href", "/events/new");

  fireEvent.keyDown(document, { key: "k", metaKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Search Club Workspace" });
  fireEvent.change(within(dialog).getByLabelText("Search Club Workspace"), {
    target: { value: "Semester" },
  });
  expect(within(dialog).getByRole("link", { name: /semester hackathon/i })).toHaveAttribute(
    "href",
    `/events/${eventId}`,
  );
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

it("keeps an activity outage out of the page-level error banner", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/me")
      return Promise.resolve(
        response({
          user: { id: memberId, email: "jordan@example.com", role: "president", tier: 2 },
        }),
      );
    if (url === "/api/tasks") return Promise.resolve(response({ tasks: [] }));
    if (url === "/api/events") return Promise.resolve(response({ items: [], nextCursor: null }));
    if (url === "/api/members") return Promise.resolve(response({ members: [] }));
    if (url === "/api/notifications") return Promise.resolve({ ok: false, status: 503 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DashboardPage />
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function task(dueAt: Date) {
  return {
    id: "018f3a4b-0000-7000-8000-000000000003",
    eventId,
    teamId: null,
    assignee: memberId,
    creator: memberId,
    title: "Confirm Venue Access",
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
