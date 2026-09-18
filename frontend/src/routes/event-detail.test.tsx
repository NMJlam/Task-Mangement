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

  it("names the thread author from the roster", async () => {
    const user = userEvent.setup();
    stubEvent({ messages: [message()], members: [roster()] });
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Thread" }));

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Lighting rig is booked.")).toBeInTheDocument();
  });

  it("marks the unbuilt tabs as unbuilt rather than empty", async () => {
    const user = userEvent.setup();
    stubEvent();
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "RSVPs" }));
    expect(await screen.findByText(/rsvp tracking is not built yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(await screen.findByText(/file attachments are not built yet/i)).toBeInTheDocument();
  });

  it("offers cancel to the president only", async () => {
    // Tier 2 also holds the treasurer — event:cancel is the president's alone,
    // so a tier check would wrongly let this through.
    stubEvent({ role: "treasurer", tier: 2 });
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Cancel Event" })).not.toBeInTheDocument();
  });

  it("confirms before sending the DELETE", async () => {
    const user = userEvent.setup();
    const fetchMock = stubEvent({ role: "president", tier: 2 });
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Cancel Event" }));
    expect(screen.getByText(/releases the unspent allocation/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm Cancellation" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(call).toBeDefined();
      expect((call as [string])[0]).toBe(`/api/events/${EVENT_ID}`);
    });
  });
});

const AUTHOR_ID = "018f3a4b-0000-7000-8000-00000000000a";

function message() {
  return {
    id: "018f3a4b-0000-7000-8000-00000000000b",
    channelId: CHANNEL_ID,
    taskId: null,
    parentId: null,
    author: AUTHOR_ID,
    body: "Lighting rig is booked.",
    fileKey: null,
    fileName: null,
    fileSizeBytes: null,
    fileMime: null,
    aiRunId: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    editedAt: null,
  };
}

function roster() {
  return {
    id: AUTHOR_ID,
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "officer",
    tier: 0,
    portfolio: null,
    teamIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubEvent({
  role = "officer",
  tier = 0,
  messages = [] as unknown[],
  members = [] as unknown[],
}: { role?: string; tier?: number; messages?: unknown[]; members?: unknown[] } = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 204 });
    if (url === "/api/me") {
      return Promise.resolve(
        ok({ user: { id: "018f3a4b-0000-7000-8000-00000000000f", email: "a@b.c", role, tier } }),
      );
    }
    if (url.includes("/progress")) return Promise.resolve(ok(progressFixture));
    if (url.includes("/messages")) return Promise.resolve(ok({ messages, nextCursor: null }));
    if (url.startsWith("/api/members")) return Promise.resolve(ok({ members }));
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
