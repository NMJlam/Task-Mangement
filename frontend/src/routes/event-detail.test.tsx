import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventDetailPage } from "./event-detail";

/**
 * Stands in for the drag provider: jsdom has no layout, so dnd-kit's own
 * collision detection can never report a drop here. The board still owns the
 * decision — this only hands it the operation a real drop would produce.
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
      assigneeIds: [],
      creator: null,
      title: "Confirm lighting",
      description: null,
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

const eventTask = eventFixture.tasks[0]!;
const GLOBAL_TASK_ID = "018f3a4b-0000-7000-8000-0000000000ff";

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

  it("renders event details and asks only for the channel", async () => {
    const fetchMock = stubEvent();
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    // `tasks` is deliberately NOT embedded: the Tasks tab reads /api/tasks.
    expect(fetchMock).toHaveBeenCalledWith(`/api/events/${EVENT_ID}?include=channel`, {
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

  it("shows the event's own tasks only once the Tasks tab is chosen", async () => {
    const user = userEvent.setup();
    const fetchMock = stubEvent();
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Confirm lighting")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Tasks" }));

    expect(await screen.findByText("Confirm lighting")).toBeInTheDocument();
    // The event filter is what the board asks with; the unfiltered list holds a
    // task this event does not own, and it must never appear.
    expect(fetchMock).toHaveBeenCalledWith(`/api/tasks?eventId=${EVENT_ID}`, {
      credentials: "include",
    });
    expect(screen.queryByText("Sweep the storeroom")).not.toBeInTheDocument();
  });

  it("changes an event task's status through the status endpoint", async () => {
    const fetchMock = stubEvent();
    renderDetail("?tab=tasks");

    await screen.findByText("Confirm lighting");

    act(() => {
      dnd.onDragEnd?.({
        canceled: false,
        operation: {
          source: { id: eventTask.id, data: { title: "Confirm lighting", status: "todo" } },
          target: { id: "blocked" },
        },
      });
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${eventTask.id}/status`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  // Task details are editable on /tasks alone; the event tab passes no onUpdate.
  it("keeps the event task dialog read-only", async () => {
    const user = userEvent.setup();
    stubEvent();
    renderDetail("?tab=tasks");

    await user.click(await screen.findByRole("button", { name: "Open Confirm lighting" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Confirm lighting" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^description$/i)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /add member to/i }),
    ).not.toBeInTheDocument();
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
  tasks = eventFixture.tasks,
}: {
  role?: string;
  tier?: number;
  messages?: unknown[];
  members?: unknown[];
  tasks?: unknown[];
} = {}) {
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
    // The board's own request. Answering the unfiltered list with a task the
    // event does not own is what proves the filter is really applied.
    if (url === `/api/tasks?eventId=${EVENT_ID}`) return Promise.resolve(ok({ tasks }));
    if (url === "/api/tasks") {
      return Promise.resolve(
        ok({
          tasks: [
            { ...eventTask, id: GLOBAL_TASK_ID, eventId: null, title: "Sweep the storeroom" },
          ],
        }),
      );
    }
    return Promise.resolve(ok({ event: eventFixture }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDetail(search = "") {
  return render(
    <MemoryRouter
      initialEntries={[`/events/${EVENT_ID}${search}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/events/:id" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
