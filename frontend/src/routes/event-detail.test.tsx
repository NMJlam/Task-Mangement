import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventDetailPage } from "./event-detail";

const EVENT_ID = "018f3a4b-0000-7000-8000-000000000001";
const CHANNEL_ID = "018f3a4b-0000-7000-8000-000000000003";

const eventFixture = {
  id: EVENT_ID,
  title: "Winter Showcase",
  description: "An evening of student work.",
  status: "planning",
  startsAt: "2026-07-20T09:00:00.000Z",
  endsAt: null,
  venue: "Guild Hall",
  minTier: 0,
  owner: null,
  attendanceEstimate: 120,
  taskCounts: { todo: 1, inProgress: 0, blocked: 0, done: 0 },
  overdueCount: 0,
  budget: { allocationCents: 50000, committedCents: 12000, spentCents: 0 },
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  channelId: CHANNEL_ID,
  tasks: [
    {
      id: "018f3a4b-0000-7000-8000-000000000002",
      eventId: EVENT_ID,
      teamId: null,
      assignee: null,
      creator: null,
      title: "Confirm lighting",
      status: "todo",
      priority: "high",
      dueAt: "2026-07-10T09:00:00.000Z",
      boardOrder: 0,
      minTier: 0,
      completedAt: null,
      aiRunId: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
};

const progressFixture = {
  percentComplete: 0,
  overdueCount: 1,
  daysUntil: 15,
  budgetBurn: 0.24,
  risk: "at_risk",
  riskReasons: ["1 overdue task"],
};

describe("EventDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders event details and asks for the channel alongside the tasks", async () => {
    const fetchMock = stubEvent();
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${EVENT_ID}?include=tasks,channel`, {
      credentials: "include",
    });
  });

  it("shows an actionable error when the API returns an HTML error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      }),
    );
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the event: Failed to load event. Refresh the page to try again.",
    );
  });

  it("opens on Overview and shows the risk verdict", async () => {
    stubEvent();
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("1 overdue task")).toBeInTheDocument();
  });

  it("shows the task board only once the Tasks tab is chosen", async () => {
    const user = userEvent.setup();
    stubEvent();
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Confirm lighting")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Tasks" }));

    expect(await screen.findByText("Confirm lighting")).toBeInTheDocument();
  });

  it("takes the open tab from the URL", async () => {
    stubEvent();
    renderDetail("?tab=tasks");

    expect(await screen.findByText("Confirm lighting")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true");
  });
});

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubEvent({ role = "member", tier = 0 }: { role?: string; tier?: number } = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/me") {
      return Promise.resolve(ok({ user: { id: "018f3a4b-0000-7000-8000-00000000000f", email: "a@b.c", role, tier } }));
    }
    if (url.includes("/progress")) return Promise.resolve(ok(progressFixture));
    if (url.includes("/messages")) return Promise.resolve(ok({ messages: [] }));
    if (url.startsWith("/api/members")) return Promise.resolve(ok({ members: [] }));
    return Promise.resolve(ok({ event: eventFixture }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDetail(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/events/${EVENT_ID}${search}`]}>
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
