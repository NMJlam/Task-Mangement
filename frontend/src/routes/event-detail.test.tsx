import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventDetailPage } from "./event-detail";

/**
 * Stands in for the drag provider: jsdom has no layout, so dnd-kit's own
 * collision detection can never report a drop here. The board still owns the
 * decision — this only hands it the operation a real drop would produce.
 * `SortableFake` is what the mocked `isSortable` accepts, so the board's own
 * guard runs rather than being bypassed.
 */
const dnd = vi.hoisted(() => {
  class SortableFake {
    id: string;
    index: number;
    group: string;
    data?: Record<string, unknown>;

    constructor(fields: {
      id: string;
      index: number;
      group: string;
      data?: Record<string, unknown>;
    }) {
      this.id = fields.id;
      this.index = fields.index;
      this.group = fields.group;
      this.data = fields.data;
    }
  }

  return { onDragEnd: undefined as ((event: unknown) => void) | undefined, SortableFake };
});

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

vi.mock("@dnd-kit/react/sortable", () => ({
  useSortable: () => ({ ref: () => {}, handleRef: () => {}, isDragging: false }),
  isSortable: (element: unknown) => element instanceof dnd.SortableFake,
}));

const EVENT_ID = "018f3a4b-0000-7000-8000-000000000001";
/** The signed-in member, as `/api/me` reports it. */
const ME_ID = "018f3a4b-0000-7000-8000-00000000000f";
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
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
/** The fixture's start, parsed: the picker shows it in local time. */
const stored = new Date(eventFixture.startsAt);
const GLOBAL_TASK_ID = "018f3a4b-0000-7000-8000-0000000000ff";
/** The id the stubbed create hands back to a card made on this page. */
const NEW_TASK_ID = "018f3a4b-0000-7000-8000-0000000000fe";

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
    expect(screen.getByRole("region", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Event Budget" })).toBeInTheDocument();
  });

  it("shows the event's own tasks only once the Tasks tab is chosen", async () => {
    const user = userEvent.setup({ delay: null });
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

  it("creates a card that belongs to this event from the Tasks tab", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = stubEvent();
    renderDetail("?tab=tasks");

    await user.click(await screen.findByRole("button", { name: "Add Task" }));

    const dialog = await screen.findByRole("dialog");
    // The link is the page, not a choice: a picker with a single option would be
    // a control the reader cannot operate.
    expect(within(dialog).queryByLabelText(/^linked event$/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Adds a card to Winter Showcase/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^task$/i), "Book the rig");
    await user.click(within(dialog).getByRole("button", { name: "Add Task" }));

    // The event id is not `FormData` — the field is not rendered — so this is
    // what proves a card made here is filed under the event it was made in.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === "/api/tasks" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call as [string, RequestInit])[1].body))).toMatchObject({
        eventId: EVENT_ID,
        title: "Book the rig",
      });
    });

    // A successful create closes the modal and puts the card on this board.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Book the rig")).toBeInTheDocument();
  });

  /**
   * Delivery Progress and the risk verdict come from the event's own reads, not
   * from the board, so a move used to leave them showing the page's first load
   * until the reader left the event and came back.
   */
  it("re-reads delivery progress and risk once a task move lands", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = stubEvent();
    const answer = fetchMock.getMockImplementation()!;
    let moved = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/tasks/${eventTask.id}/status` && init?.method === "PATCH") {
        moved = true;
        return Promise.resolve(
          ok({ task: { ...eventTask, status: "done", completedAt: "2026-06-02T00:00:00.000Z" } }),
        );
      }
      if (moved && url === `/api/events/${EVENT_ID}?include=channel`) {
        return Promise.resolve(
          ok({
            event: {
              ...eventFixture,
              taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 1 },
              overdueCount: 0,
            },
          }),
        );
      }
      if (moved && url.includes("/progress")) {
        return Promise.resolve(
          ok({
            ...progressFixture,
            percentComplete: 100,
            overdueCount: 0,
            risk: "on_track",
            riskReasons: [],
          }),
        );
      }
      return answer(url, init);
    });
    renderDetail("?tab=tasks");
    await screen.findByText("Confirm lighting");

    act(() => {
      dnd.onDragEnd?.({
        canceled: false,
        operation: {
          source: new dnd.SortableFake({
            id: eventTask.id,
            index: 0,
            group: "todo",
            data: { title: "Confirm lighting", status: "todo" },
          }),
          target: { id: "done" },
        },
      });
    });
    // The same board as `/tasks`: a drop on the Done column body takes its
    // status and the end of that column.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${eventTask.id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "done", after: null }),
        }),
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Overview" }));

    await waitFor(() =>
      expect(screen.getByRole("progressbar", { name: "Tasks complete" })).toHaveAttribute(
        "aria-valuenow",
        "100",
      ),
    );
    expect(await screen.findByText("On Track")).toBeInTheDocument();
  });

  // The event Tasks tab now wires the same shared dialog mutations as /tasks.
  it("edits an event task's description and priority in place", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = stubEvent();
    renderDetail("?tab=tasks");

    await user.click(await screen.findByRole("button", { name: "Open Confirm lighting" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Confirm lighting" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "View event" })).toHaveAttribute(
      "href",
      `/events/${EVENT_ID}`,
    );

    const field = within(dialog).getByLabelText(/^description$/i);
    fireEvent.change(field, { target: { value: "Book the rig." } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${eventTask.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ description: "Book the rig." }),
        }),
      ),
    );
    // The dialog shows the row the server returned.
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^description$/i)).toHaveValue("Book the rig."),
    );

    await user.selectOptions(within(dialog).getByLabelText(/^priority$/i), "low");

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${eventTask.id}`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ priority: "low" }) }),
      ),
    );
    await waitFor(() => expect(within(dialog).getByLabelText(/^priority$/i)).toHaveValue("low"));
  });

  // Same shared dialog as /tasks, so the same tier rule has to reach it here —
  // a task deletable on one board and not the other would be arbitrary.
  it("deletes an event task from the dialog once a tier-1 member confirms", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = stubEvent({ role: "director", tier: 1 });
    renderDetail("?tab=tasks");

    await user.click(await screen.findByRole("button", { name: "Open Confirm lighting" }));
    await user.click(await screen.findByRole("button", { name: "Delete Task" }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${eventTask.id}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("Confirm lighting")).not.toBeInTheDocument();
  });

  it("offers no delete control on the Tasks tab below tier 1", async () => {
    const user = userEvent.setup({ delay: null });
    stubEvent({ role: "officer", tier: 0 });
    renderDetail("?tab=tasks");

    await user.click(await screen.findByRole("button", { name: "Open Confirm lighting" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText(/^priority$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Task" })).not.toBeInTheDocument();
  });

  it("links a tier-1 member to the assistant, seeded with this event", async () => {
    stubEvent({ role: "director", tier: 1 });
    renderDetail("?tab=tasks");

    const link = await screen.findByRole("link", { name: "Plan with AI" });

    expect(link).toHaveAttribute("href", `/ai?eventId=${EVENT_ID}`);
  });

  it("offers no Plan with AI link below tier 1, who could not create the plan", async () => {
    stubEvent({ role: "officer", tier: 0 });
    renderDetail("?tab=tasks");

    await screen.findByRole("button", { name: "Add Task" });

    expect(screen.queryByRole("link", { name: "Plan with AI" })).not.toBeInTheDocument();
  });

  it("names the thread author from the roster", async () => {
    const user = userEvent.setup({ delay: null });
    stubEvent({ messages: [message()], members: [roster()] });
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Thread" }));

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Lighting rig is booked.")).toBeInTheDocument();
  });

  describe("Thread tab", () => {
    it("chats in the event's own thread, from the same box as Messages", async () => {
      const fetchMock = stubEvent({ messages: [message()], members: [roster()] });
      renderDetail("?tab=thread");

      const box = await screen.findByLabelText(/message winter showcase/i);
      fireEvent.change(box, { target: { value: "Doors at six." } });
      fireEvent.keyDown(box, { key: "Enter" });

      expect(await screen.findByText("Doors at six.")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/threads/${CHANNEL_ID}/messages`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ body: "Doors at six." }),
        }),
      );
      expect(box).toHaveValue("");
    });

    it("keeps Summarise above the chat, and its summary through a search", async () => {
      const user = userEvent.setup({ delay: null });
      const fetchMock = stubEvent({ messages: [message()], members: [roster()] });
      // The search's answer is held back, so its loading state really renders —
      // an instant stub would land before React ever drew it.
      let land: (value: unknown) => void = () => undefined;
      const answer = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((url: string, init?: RequestInit) =>
        url.includes("?q=")
          ? new Promise((resolve) => {
              land = resolve;
            })
          : answer(url, init),
      );
      renderDetail("?tab=thread");

      const summarise = await screen.findByRole("button", { name: "Summarise thread" });
      const box = await screen.findByLabelText(/message winter showcase/i);
      expect(
        summarise.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await user.click(summarise);
      expect(await screen.findByText(SUMMARY_POINT)).toBeInTheDocument();

      await user.type(screen.getByLabelText(/search this conversation/i), "rig");
      expect(
        await screen.findByText("Loading Messages…", undefined, { timeout: 1000 }),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/threads/${CHANNEL_ID}/messages?q=rig`,
        expect.anything(),
      );
      // Mid-search, and once the results are in: still the summary already asked for.
      expect(screen.getByText(SUMMARY_POINT)).toBeInTheDocument();
      await act(async () => land(ok({ messages: [message()], nextCursor: null })));
      expect(await screen.findByText("Lighting rig is booked.")).toBeInTheDocument();
      expect(screen.getByText(SUMMARY_POINT)).toBeInTheDocument();
    });

    it("links back to the same conversation on Messages", async () => {
      stubEvent({ messages: [message()], members: [roster()] });
      renderDetail("?tab=thread");

      expect(await screen.findByRole("link", { name: "Open in Messages" })).toHaveAttribute(
        "href",
        `/messages?thread=${CHANNEL_ID}`,
      );
    });

    it("offers no summary of an empty thread, which the server would refuse", async () => {
      stubEvent();
      renderDetail("?tab=thread");

      expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Summarise thread" })).not.toBeInTheDocument();
    });

    it("offers no summary when a thread contains only file attachments", async () => {
      stubEvent({
        messages: [
          {
            ...message(),
            body: "",
            fileKey: "threads/plan.pdf",
            fileName: "plan.pdf",
            fileSizeBytes: 20,
            fileMime: "application/pdf",
          },
        ],
      });
      renderDetail("?tab=thread");
      expect(await screen.findByText("plan.pdf")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Summarise thread" })).not.toBeInTheDocument();
    });

    it("offers no summary when a thread contains only tombstones", async () => {
      stubEvent({
        messages: [
          { ...message(), body: "", deletedAt: "2026-06-03T00:00:00.000Z", deletedBy: ME_ID },
        ],
      });
      renderDetail("?tab=thread");
      expect(await screen.findByText("Message deleted")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Summarise thread" })).not.toBeInTheDocument();
    });

    /**
     * A cancelled event's thread is a read-only archive (the API answers a post
     * with 409 THREAD_ARCHIVED), and Messages does not list it, so there is no
     * box to type in and no "Open in Messages" to send the reader nowhere.
     */
    it("shows a cancelled event's thread read-only, with no box and no way to Messages", async () => {
      stubEvent({
        event: { ...eventFixture, status: "cancelled" },
        messages: [message()],
        members: [roster()],
      });
      renderDetail("?tab=thread");

      expect(await screen.findByText("Lighting rig is booked.")).toBeInTheDocument();
      expect(
        screen.getByText("This event was cancelled, so its thread is read-only."),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/message winter showcase/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Open in Messages" })).not.toBeInTheDocument();
    });

    it("offers no deletion in a cancelled event's archive, to the president either", async () => {
      stubEvent({
        role: "president",
        tier: 2,
        event: { ...eventFixture, status: "cancelled" },
        messages: [message()],
        members: [roster()],
      });
      renderDetail("?tab=thread");

      expect(await screen.findByText("Lighting rig is booked.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Delete message/ })).not.toBeInTheDocument();
    });

    it("deletes a message from the Thread tab, and takes down a summary written from it", async () => {
      const user = userEvent.setup({ delay: null });
      const fetchMock = stubEvent({
        role: "president",
        tier: 2,
        messages: [message()],
        members: [roster()],
      });
      const answer = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === "DELETE" && url.includes("/messages/")) {
          return Promise.resolve(
            ok({
              message: {
                ...message(),
                body: "",
                deletedAt: "2026-06-03T00:00:00.000Z",
                deletedBy: ME_ID,
              },
            }),
          );
        }
        if (url.includes("/summary/validity")) return Promise.resolve(ok({ current: false }));
        return answer(url, init);
      });
      renderDetail("?tab=thread");

      await user.click(await screen.findByRole("button", { name: "Summarise thread" }));
      expect(await screen.findByText(SUMMARY_POINT)).toBeInTheDocument();

      // Someone else's message: the president moderates it.
      await user.click(screen.getByRole("button", { name: /^Delete message from Ada Lovelace/ }));
      const dialog = await screen.findByRole("dialog", {
        name: "Delete this message for everyone?",
      });
      await user.click(within(dialog).getByRole("button", { name: "Delete message" }));

      expect(await screen.findByText("Message deleted")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/threads/${CHANNEL_ID}/messages/${message().id}`,
        expect.objectContaining({ method: "DELETE" }),
      );
      await waitFor(() => expect(screen.queryByText(SUMMARY_POINT)).not.toBeInTheDocument());
      expect(screen.getByText(/has been deleted, so it was taken down/)).toBeInTheDocument();
      expect(screen.getByText(/There are no messages left to summarise/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Summarise thread" })).not.toBeInTheDocument();
    });

    it("names a message the assistant wrote as the assistant", async () => {
      stubEvent({
        messages: [{ ...message(), aiRunId: "018f3a4b-0000-7000-8000-0000000000c0" }],
        members: [roster()],
      });
      renderDetail("?tab=thread");

      expect(await screen.findByText("MAC Assistant")).toBeInTheDocument();
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    });
  });

  /**
   * File upload (R11) and RSVPs (R4) are deferred, so their placeholder tabs
   * are gone. A link saved while they existed opens the Overview, not a
   * tabset with nothing selected.
   */
  it("offers only the built tabs, and opens Overview for a tab that no longer exists", async () => {
    stubEvent();
    renderDetail("?tab=files");

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Tasks",
      "Thread",
    ]);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("reschedules the event through the shared visual picker", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = stubEvent({ role: "president", tier: 2 });
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Edit Dates" }));
    const dialog = await screen.findByRole("dialog");

    // Pre-filled from what is stored; the start is required so it offers no Clear.
    expect(within(dialog).getByLabelText("Start date")).toHaveTextContent(
      dateFormat.format(stored),
    );
    expect(within(dialog).queryByRole("button", { name: /^clear start/i })).not.toBeInTheDocument();

    const nextDay = new Date(2026, 6, 24, 18, 0);
    await user.click(within(dialog).getByLabelText("Start date"));
    const picker = await screen.findByRole("dialog", { name: "Pick the start date" });
    const cell = document.querySelector('[data-day="2026-07-24"]');
    if (!cell) throw new Error("No calendar cell for 2026-07-24");
    await user.click(within(cell as HTMLElement).getByRole("button"));
    const timeField = within(picker).getByLabelText("Start time");
    await user.clear(timeField);
    await user.type(timeField, "18:00");
    await user.click(within(picker).getByRole("button", { name: "Apply" }));

    await user.click(within(dialog).getByRole("button", { name: "Save dates" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call as [string, RequestInit])[1].body))).toEqual({
        startsAt: nextDay.toISOString(),
        // No end time stored, so there is none to move.
        endsAt: null,
      });
    });

    // The page then shows the instants the server returned.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelector(`time[datetime="${nextDay.toISOString()}"]`)).toBeInTheDocument();
  });

  // The route's rule, not a capability: owner or lead-and-above.
  it("offers Edit Dates to the owner and to leads, but not to an outsider", async () => {
    stubEvent({ role: "officer", tier: 0 });
    const { unmount } = renderDetail();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Edit Dates" })).not.toBeInTheDocument();
    unmount();

    // Owning it is one half of the rule…
    stubEvent({
      role: "officer",
      tier: 0,
      event: { ...eventFixture, owner: { id: ME_ID, name: "Me" } },
    });
    const owned = renderDetail();
    expect(await screen.findByRole("button", { name: "Edit Dates" })).toBeInTheDocument();
    owned.unmount();

    // …and being a lead is the other.
    stubEvent({ role: "director", tier: 1 });
    renderDetail();
    expect(await screen.findByRole("button", { name: "Edit Dates" })).toBeInTheDocument();
  });

  it("edits the event's details through the shared PATCH, dates excluded", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = stubEvent({ role: "director", tier: 1 });
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Edit Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit event details" })).toBeInTheDocument();
    // Dates belong to their own dialog; this one must not offer a second picker.
    expect(within(dialog).queryByLabelText(/start date/i)).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Venue"), {
      target: { value: "Macquarie Theatre" },
    });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "  Doors at 6.  " },
    });
    await user.selectOptions(within(dialog).getByLabelText("Visibility"), "1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save details" }));

    // The whole patch, in the field names the route validates.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call as [string, RequestInit])[1].body)) as object;
      expect(body).toMatchObject({
        title: "Winter Showcase",
        venue: "Macquarie Theatre",
        // Trimmed by the shared schema before it is sent, not by the dialog.
        description: "Doors at 6.",
        attendanceEstimate: 120,
        minTier: 1,
      });
      // A director cannot allocate, and an unchanged allocation is not sent at
      // all — the route reads any allocation it receives as a budget decision.
      expect(body).not.toHaveProperty("allocationCents");
    });

    // And the page shows what the server returned, not the draft.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Macquarie Theatre")).toBeInTheDocument();
  });

  it("lets only a budget manager change the allocation", async () => {
    const user = userEvent.setup({ delay: null });
    stubEvent({ role: "director", tier: 1 });
    const director = renderDetail();
    await user.click(await screen.findByRole("button", { name: "Edit Details" }));
    const readOnly = within(await screen.findByRole("dialog")).getByLabelText(
      "Budget Allocation (AUD)",
    );
    expect(readOnly).toBeDisabled();
    expect(readOnly).toHaveAccessibleDescription(/president or treasurer/i);
    director.unmount();

    const fetchMock = stubEvent({ role: "treasurer", tier: 2 });
    renderDetail();
    await user.click(await screen.findByRole("button", { name: "Edit Details" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("Budget Allocation (AUD)");
    expect(field).toBeEnabled();
    fireEvent.change(field, { target: { value: "650" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call as [string, RequestInit])[1].body))).toMatchObject({
        allocationCents: 65000,
      });
    });
  });

  it("moves the event along its lifecycle, and reports a blocked wrap in the route's own words", async () => {
    const user = userEvent.setup({ delay: null });
    let wrapBlocked = false;
    // The event page's own stub, wrapped so the status route can be driven. The
    // inner mock is captured ONCE: calling `stubEvent` per request would
    // re-stub the global mid-flight and record the calls nowhere.
    const base = stubEvent({ role: "director", tier: 1 });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === `/api/events/${EVENT_ID}/status` && init?.method === "PATCH") {
        const { status } = JSON.parse(String(init.body)) as { status: string };
        if (status === "wrapped" && wrapBlocked) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({
              id: EVENT_ID,
              status: "live",
              blockers: ["2 pending expenses must be resolved before wrapping"],
            }),
          });
        }
        return Promise.resolve(ok({ id: EVENT_ID, status, blockers: [] }));
      }
      return base(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDetail();

    // Planning offers exactly one next state, and it is the legal one.
    await user.click(await screen.findByRole("button", { name: "Move to Live" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/events/${EVENT_ID}/status`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "live" }) }),
      ),
    );
    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to Live" })).not.toBeInTheDocument();

    // A refused wrap must not become a generic error: the blockers ARE the
    // message, and the status stays where it was.
    wrapBlocked = true;
    await user.click(await screen.findByRole("button", { name: "Mark Wrapped" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The event status did not change.");
    expect(alert).toHaveTextContent("2 pending expenses must be resolved before wrapping");
    expect(screen.queryByText("Wrapped")).not.toBeInTheDocument();
  });

  it("hides the lifecycle control from tier 0, which the route would refuse", async () => {
    stubEvent({ role: "officer", tier: 0 });
    renderDetail();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Winter Showcase" })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /move to live|mark wrapped/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps a navigation route and a heading on the failure states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/me") {
          return Promise.resolve(
            ok({ user: { id: ME_ID, email: "a@b.c", role: "officer", tier: 0 } }),
          );
        }
        if (url.includes("/progress")) return Promise.resolve(ok(progressFixture));
        if (url.startsWith("/api/members")) return Promise.resolve(ok({ members: [] }));
        if (url.startsWith("/api/tasks")) return Promise.resolve(ok({ tasks: [] }));
        if (url.startsWith("/api/events/"))
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        return Promise.resolve(ok({ event: eventFixture }));
      }),
    );
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Event not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("alert")).toHaveTextContent("This event could not be found.");
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
    const user = userEvent.setup({ delay: null });
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
/** What the stubbed thread summary says. */
const SUMMARY_POINT = "Rig is booked; doors at six.";

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
    deletedAt: null,
    deletedBy: null,
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
  event = eventFixture,
}: {
  role?: string;
  tier?: number;
  messages?: unknown[];
  members?: unknown[];
  tasks?: unknown[];
  event?: Record<string, unknown>;
} = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return Promise.resolve({ ok: true, status: 204 });
    // Rescheduling echoes the stored row back, which is what the route returns.
    if (url === `/api/events/${EVENT_ID}` && init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body)) as { startsAt: string; endsAt: string | null };
      return Promise.resolve(ok({ event: { ...event, ...patch } }));
    }
    // The Tasks tab's shared dialog edits the task in place; echo the patch back
    // the way the route does, so the dialog can show the stored row.
    if (url === `/api/tasks/${eventTask.id}` && init?.method === "PATCH") {
      return Promise.resolve(
        ok({ task: { ...eventTask, ...(JSON.parse(String(init.body)) as object) } }),
      );
    }
    if (url === "/api/me") {
      return Promise.resolve(
        ok({ user: { id: "018f3a4b-0000-7000-8000-00000000000f", email: "a@b.c", role, tier } }),
      );
    }
    if (url.includes("/progress")) return Promise.resolve(ok(progressFixture));
    // A post comes back as the stored row, written by the signed-in member.
    if (url === `/api/threads/${CHANNEL_ID}/messages` && init?.method === "POST") {
      const { body } = JSON.parse(String(init.body)) as { body: string };
      return Promise.resolve(
        ok({
          message: {
            ...message(),
            id: "018f3a4b-0000-7000-8000-00000000000c",
            author: ME_ID,
            body,
            createdAt: "2026-06-03T00:00:00.000Z",
          },
        }),
      );
    }
    if (url.includes("/messages")) return Promise.resolve(ok({ messages, nextCursor: null }));
    if (url === `/api/ai/threads/${CHANNEL_ID}/summary`) {
      return Promise.resolve(
        ok({
          summary: { summary: [SUMMARY_POINT], actionItems: [] },
          asOfMessageId: message().id,
          sourceFingerprint: "fp-1",
        }),
      );
    }
    if (url.startsWith("/api/members")) return Promise.resolve(ok({ members }));
    // The board's own request. Answering the unfiltered list with a task the
    // event does not own is what proves the filter is really applied.
    if (url === `/api/tasks?eventId=${EVENT_ID}`) return Promise.resolve(ok({ tasks }));
    // The create dialog's POST: the stored row comes back, id and defaults
    // included, exactly as the route answers.
    if (url === "/api/tasks" && init?.method === "POST") {
      const input = JSON.parse(String(init.body)) as { title: string };
      return Promise.resolve(
        ok({
          task: { ...eventTask, id: NEW_TASK_ID, title: input.title, priority: "medium" },
        }),
      );
    }
    if (url === "/api/tasks") {
      return Promise.resolve(
        ok({
          tasks: [
            { ...eventTask, id: GLOBAL_TASK_ID, eventId: null, title: "Sweep the storeroom" },
          ],
        }),
      );
    }
    return Promise.resolve(ok({ event }));
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
