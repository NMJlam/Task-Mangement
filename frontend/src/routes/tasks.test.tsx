import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { TasksPage } from "./tasks";

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

vi.mock("@/hooks/use-events", () => ({
  useEvents: () => ({
    state: {
      status: "ok" as const,
      items: [
        {
          id: "018f3a4b-0000-7000-8000-000000000010",
          title: "Winter Showcase",
          status: "planning",
        },
      ],
    },
  }),
}));

const taskId = "018f3a4b-0000-7000-8000-000000000001";
const ada = { id: "018f3a4b-0000-7000-8000-00000000000a", name: "Ada Lovelace" };
const grace = { id: "018f3a4b-0000-7000-8000-00000000000b", name: "Grace Hopper" };
const EVENT_ID = "018f3a4b-0000-7000-8000-000000000010";

/**
 * The day the picker's grid is showing, and the instant a time on it means.
 *
 * Read from the real clock because the popover opens on the current month with
 * nothing selected: `data-day` is the library's handle on a cell (its accessible
 * name is locale-formatted), and the composed value is local wall-clock time,
 * which is what the deadline is.
 */
function todayLocal() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    isoDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    at: (hours: number, minutes: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes),
  };
}

function dayCell(isoDate: string) {
  const cell = document.querySelector(`[data-day="${isoDate}"]`);
  if (!cell) throw new Error(`No calendar cell for ${isoDate}`);
  return within(cell as HTMLElement).getByRole("button");
}

/** The card's column is read off the DOM, which is the observable result. */
function columnOf(title: string, label: string) {
  const column = screen.getByRole("heading", { name: label }).closest("section");
  if (!column) throw new Error(`No column for ${label}`);
  return within(column).queryByText(title) !== null;
}

function dropCard(status: string) {
  act(() => {
    dnd.onDragEnd?.({
      canceled: false,
      operation: {
        source: { id: taskId, data: { title: "Confirm venue access", status: "todo" } },
        target: { id: status },
      },
    });
  });
}

/** The dialog links to `/events/:id`, so the page needs a router in scope. */
function renderPage(initialPath = "/tasks") {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TasksPage />
      {/* The URL IS the filter state, so a test has to be able to read it. */}
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="tasks-location">{location.pathname + location.search}</p>;
}

/** The signed-in member, as `/api/me` reports it. */
function me() {
  return {
    id: "018f3a4b-0000-7000-8000-00000000000f",
    email: "me@example.com",
    role: "officer",
    tier: 0,
  };
}

/** The board's last read, whichever endpoint the page chose for it. */
function taskRequest(fetchMock: Mock): URL | undefined {
  const call = fetchMock.mock.calls
    .filter(
      ([input, init]) =>
        (init as RequestInit | undefined)?.method === undefined &&
        String(input).startsWith("/api/tasks"),
    )
    .at(-1);
  return call ? new URL(String(call[0]), "http://localhost") : undefined;
}

describe("TasksPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a task through the Add Tasks modal and shows it on the board", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const due = todayLocal();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST")
        return Promise.resolve(
          response({
            task: {
              ...task,
              id: "018f3a4b-0000-7000-8000-000000000002",
              title: "Book AV",
              // Echoed the way the route returns the stored row: trimmed.
              description: "Two mics and the AV cart.",
              priority: "urgent",
              eventId: EVENT_ID,
              assigneeIds: [ada.id, grace.id],
            },
          }),
        );
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Tasks" }));
    const dialog = await screen.findByRole("dialog");
    // The event list has loaded by now, so the control offers real choices.
    await waitFor(() => expect(within(dialog).getByLabelText(/^linked event$/i)).toBeEnabled());

    await user.type(within(dialog).getByLabelText(/^task$/i), "Book AV");
    await user.type(within(dialog).getByLabelText(/^description$/i), "Two mics and the AV cart.");
    await user.selectOptions(within(dialog).getByLabelText(/^priority$/i), "urgent");
    await user.selectOptions(within(dialog).getByLabelText(/^linked event$/i), EVENT_ID);
    // The due date is a popover, not a form field: a day and a time, then Apply.
    await user.click(within(dialog).getByLabelText(/^due date$/i));
    await user.click(dayCell(due.isoDate));
    await user.type(screen.getByLabelText("Deadline time"), "14:30");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // The same searchable picker as the task modal, including its filter: a mixed
    // -case query narrows the roster before anything is clicked.
    await user.click(within(dialog).getByRole("button", { name: /^add member to this task$/i }));
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: "aDA" } });
    expect(
      screen.queryByRole("button", { name: /^assign grace hopper$/i }),
    ).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^assign ada lovelace$/i }));

    await user.click(screen.getByRole("button", { name: /^assign grace hopper$/i }));
    await user.click(within(dialog).getByRole("button", { name: "Add Task" }));

    // The exact wire body: what the user chose, plus the schema's own defaults.
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body).toMatchObject({
        title: "Book AV",
        description: "Two mics and the AV cart.",
        priority: "urgent",
        eventId: EVENT_ID,
        // Selection order is what the picker reported.
        assigneeIds: [ada.id, grace.id],
      });
      // The wall-clock deadline the picker composed, as an instant on the wire.
      expect(body.dueAt).toBe(due.at(14, 30).toISOString());
    });

    // A successful create closes the modal and puts the card on the board.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const created = screen
      .getByRole("button", { name: "Open Book AV" })
      .closest("[data-slot='card']");
    expect(created).not.toBeNull();
    // The event chip belongs to THAT card, not merely to the page — the filter
    // bar's event picker also names the event.
    expect(within(created as HTMLElement).getByText("Winter Showcase")).toBeInTheDocument();

    // The description typed at creation is on the card it created.
    await user.click(screen.getByRole("button", { name: "Open Book AV" }));
    expect(await screen.findByLabelText(/^description$/i)).toHaveValue("Two mics and the AV cart.");
  });

  it("keeps the modal open with its entries when the create fails", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST")
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Add Tasks" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^task$/i), "Book AV");
    await user.click(within(dialog).getByRole("button", { name: "Add Task" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Failed to create task. Try again.",
    );
    // Nothing typed is thrown away, so the retry is one click.
    expect(within(dialog).getByLabelText(/^task$/i)).toHaveValue("Book AV");
  });

  it("links a task to an event and exposes the event page from the modal", async () => {
    const user = userEvent.setup();
    const task = { ...buildTask(), eventId: EVENT_ID };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}` && init?.method === "PATCH") {
        return Promise.resolve(response({ task: { ...task, eventId: EVENT_ID } }));
      }
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await user.click(await screen.findByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "View event" })).toHaveAttribute(
      "href",
      `/events/${EVENT_ID}`,
    );

    await user.selectOptions(within(dialog).getByLabelText("Linked event"), "");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ eventId: null }) }),
      );
    });
  });

  it("changes a task's priority from the modal", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return Promise.resolve(response({ task: { ...task, ...body } }));
      }
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await user.click(await screen.findByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText(/^priority$/i);
    expect(select).toHaveValue("high");

    await user.selectOptions(select, "low");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ priority: "low" }) }),
      );
    });
    // The dialog shows what the server returned, not the raw selection.
    await waitFor(() => expect(within(dialog).getByLabelText(/^priority$/i)).toHaveValue("low"));
  });

  it("moves an existing card's deadline from the modal, then clears it", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const due = todayLocal();
    const sentBodies: unknown[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        sentBodies.push(body);
        return Promise.resolve(response({ task: { ...task, dueAt: body.dueAt } }));
      }
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await user.click(await screen.findByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");
    // The card had no deadline, so the row offers the control's empty state.
    const dueRow = () => within(dialog).getByLabelText(/^due date$/i);
    expect(dueRow()).toHaveTextContent("Select due date");

    await user.click(dueRow());
    await user.click(dayCell(due.isoDate));
    await user.type(screen.getByLabelText("Deadline time"), "09:15");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    // The same `PATCH /api/tasks/:id` channel as priority and assignees.
    await waitFor(() => expect(sentBodies).toEqual([{ dueAt: due.at(9, 15).toISOString() }]));
    await waitFor(() => expect(dueRow()).toBeEnabled());

    // Clear is a real edit, not an omission: `null` removes the deadline.
    await user.click(dueRow());
    await user.click(screen.getByRole("button", { name: "Clear due date" }));

    await waitFor(() =>
      expect(sentBodies).toEqual([{ dueAt: due.at(9, 15).toISOString() }, { dueAt: null }]),
    );
    await waitFor(() => expect(dueRow()).toHaveTextContent("Select due date"));
  });

  it("filters the board by title, case-insensitively", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const other = { ...buildTask(), id: "018f3a4b-0000-7000-8000-000000000003", title: "Book AV" };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task, other] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Book AV")).toBeInTheDocument());

    const search = screen.getByLabelText(/search tasks/i);
    await user.type(search, "BOOK av");

    expect(screen.queryByText("Confirm venue access")).not.toBeInTheDocument();
    expect(screen.getByText("Book AV")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "nothing like this");
    expect(
      screen.getByText(/No tasks match these filters: matching “nothing like this”\./),
    ).toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByText("Confirm venue access")).toBeInTheDocument();
    expect(screen.getByText("Book AV")).toBeInTheDocument();
  });

  it("turns the URL's filters into a server read, and Clear Filters back into /tasks", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(response({ user: me() }));
      if (url.startsWith("/api/tasks")) return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      if (url.startsWith("/api/events")) return Promise.resolve(response({ items: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage(`/tasks?scope=mine&status=todo&priority=urgent&event=${EVENT_ID}&overdue=true`);

    // Overdue IS `status <> 'done'`, so the status parameter is dropped rather
    // than sent as a contradiction, and the read goes to the derived endpoint.
    await waitFor(() => expect(taskRequest(fetchMock)).toBeDefined());
    const request = taskRequest(fetchMock)!;
    expect(request.pathname).toBe("/api/tasks/overdue");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      assignee: me().id,
      eventId: EVENT_ID,
      priority: "urgent",
    });

    // The board shows only what came back — filtering is the server's answer,
    // not a view over a page the client happened to hold.
    expect(await screen.findByText("Confirm venue access")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear Filters" }));

    // The canonical unfiltered URL, with every defaulted key dropped.
    await waitFor(() => expect(screen.getByTestId("tasks-location")).toHaveTextContent("/tasks"));
    expect(screen.getByTestId("tasks-location")).not.toHaveTextContent("overdue");
    await waitFor(() => expect(taskRequest(fetchMock)!.search).toBe(""));
    expect(taskRequest(fetchMock)!.pathname).toBe("/api/tasks");
  });

  it("falls back to defaults for filter values the URL invents", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(response({ user: me() }));
      if (url.startsWith("/api/tasks")) return Promise.resolve(response({ tasks: [] }));
      if (url === "/api/members") return Promise.resolve(response({ members: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage("/tasks?status=urgent-ish&priority=nonsense&event=not-a-uuid&scope=everyone");

    await waitFor(() => expect(taskRequest(fetchMock)).toBeDefined());
    // Nothing invalid reaches the API, and the whole board is read.
    expect(Object.fromEntries(taskRequest(fetchMock)!.searchParams)).toEqual({});
    expect(screen.getByLabelText("Status")).toHaveValue("");
    expect(screen.getByLabelText("Priority")).toHaveValue("");
    expect(screen.getByRole("button", { name: "All Tasks" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Clear Filters" })).not.toBeInTheDocument();
  });

  it("names the active filters and offers Clear Filters when nothing matches", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return Promise.resolve(response({ user: me() }));
      if (url.startsWith("/api/tasks")) return Promise.resolve(response({ tasks: [] }));
      if (url === "/api/members") return Promise.resolve(response({ members: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage("/tasks?scope=mine&priority=urgent&overdue=true");

    expect(
      await screen.findByText(
        "No tasks match these filters: assigned to you, overdue, urgent priority. Use Clear Filters to widen the board.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Filters" })).toBeInTheDocument();
    // Filtering swaps the cards with no other cue, so the count is announced.
    expect(screen.getByRole("status")).toHaveTextContent("0 tasks match the current filters.");
  });

  it("cannot answer a scope=mine read without identity, and says so instead of guessing", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me")
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (url.startsWith("/api/tasks")) return Promise.resolve(response({ tasks: [] }));
      if (url === "/api/members") return Promise.resolve(response({ members: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage("/tasks?scope=mine");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load your membership, so your tasks can't be listed.",
    );
    // The unfiltered list is never issued as a stand-in: it answers a different
    // question and nothing on screen would say so.
    expect(taskRequest(fetchMock)).toBeUndefined();
    expect(screen.getByRole("link", { name: "Show all tasks" })).toHaveAttribute("href", "/tasks");
  });

  it("moves a dropped card into the new column and PATCHes its status", async () => {
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}/status` && init?.method === "PATCH")
        return Promise.resolve(response({ task: { ...task, status: "in_progress" } }));
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    expect(columnOf("Confirm venue access", "To Do")).toBe(true);

    dropCard("in_progress");

    // No await between the drop and this assertion: the column changed before
    // the request could have answered.
    expect(columnOf("Confirm venue access", "In Progress")).toBe(true);
    expect(columnOf("Confirm venue access", "To Do")).toBe(false);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "in_progress" }),
        }),
      ),
    );
    expect(columnOf("Confirm venue access", "In Progress")).toBe(true);
  });

  it("puts the card back in its own column when the status write fails", async () => {
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}/status` && init?.method === "PATCH")
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());

    dropCard("in_progress");

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update task. Try again.");
    expect(columnOf("Confirm venue access", "To Do")).toBe(true);
    expect(columnOf("Confirm venue access", "In Progress")).toBe(false);
    // The handle is live again, so the user can retry the drag.
    expect(screen.getByRole("button", { name: "Move Confirm venue access" })).toBeEnabled();
  });

  // The UI behaviour this change adds: a subtle `+` beside the assignee list
  // opens a searchable member picker, and picking a member saves immediately.
  it("assigns members through the search picker", async () => {
    const task = buildTask();
    const sentBodies: string[][] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        sentBodies.push(body.assigneeIds);
        return Promise.resolve(response({ task: { ...task, assigneeIds: body.assigneeIds } }));
      }
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");

    // The picker stays shut until asked for; the list itself is not a search box.
    expect(screen.queryByLabelText(/search members/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /add member to/i }));

    // Mixed case on purpose: the filter is case-insensitive on name and email.
    fireEvent.change(screen.getByLabelText(/search members/i), {
      target: { value: "aDA" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /^assign ada lovelace$/i }));

    fireEvent.change(screen.getByLabelText(/search members/i), {
      target: { value: "grace@example.COM" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /^assign grace hopper$/i }));

    // One write per pick, each carrying the whole set.
    await waitFor(() => expect(sentBodies).toEqual([[ada.id], [ada.id, grace.id]]));

    const listed = within(dialog).getByRole("list", {
      name: /assignees for confirm venue access/i,
    });
    expect(within(listed).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(listed).getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^remove ada lovelace$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^remove grace hopper$/i })).toBeInTheDocument();
  });

  it("removes the last assignee, submitting an empty set", async () => {
    const task = { ...buildTask(), assigneeIds: [ada.id] };
    const sentBodies: string[][] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        sentBodies.push(body.assigneeIds);
        return Promise.resolve(response({ task: { ...task, assigneeIds: body.assigneeIds } }));
      }
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /add member to/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^remove ada lovelace$/i }));

    // `[]` is a real edit that clears everyone, not a missing value.
    await waitFor(() => expect(sentBodies).toEqual([[]]));
    expect(await within(dialog).findByText("Unassigned")).toBeInTheDocument();
  });

  it("saves a description on blur and clears it when emptied", async () => {
    const task = buildTask();
    const sentBodies: unknown[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        sentBodies.push(body);
        // The route stores the value the shared schema normalised: trimmed, and
        // "" collapsed to null. The response carries that, not the raw body.
        const trimmed = typeof body.description === "string" ? body.description.trim() : undefined;
        return Promise.resolve(
          response({
            task: {
              ...task,
              ...body,
              ...(trimmed === undefined ? {} : { description: trimmed === "" ? null : trimmed }),
            },
          }),
        );
      }
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(/^description$/i);
    expect(field).toHaveValue("");

    fireEvent.change(field, { target: { value: "  Chairs and the AV cart.  " } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(sentBodies).toEqual([{ description: "  Chairs and the AV cart.  " }]),
    );

    // The server normalises and returns the stored value; the field then shows it.
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^description$/i)).toHaveValue(
        "Chairs and the AV cart.",
      ),
    );

    // An emptied field is a real edit that clears the description.
    fireEvent.change(within(dialog).getByLabelText(/^description$/i), { target: { value: "" } });
    fireEvent.blur(within(dialog).getByLabelText(/^description$/i));
    await waitFor(() => expect(sentBodies).toHaveLength(2));
    expect(sentBodies[1]).toEqual({ description: "" });
  });

  it("opens the task modal from the card's overlay button", async () => {
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // jsdom cannot hit-test, so this clicks the overlay the card body is covered
    // by; that a click on the visible title reaches it is a browser concern and
    // is covered by the manual pass.
    fireEvent.click(screen.getByRole("button", { name: /^open confirm venue access$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Confirm venue access" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^description$/i)).toBeInTheDocument();
  });

  it("counts the assignees on each card", async () => {
    const task = { ...buildTask(), assigneeIds: [ada.id, grace.id] };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByTitle("2 assignees")).toHaveTextContent("2");
  });

  it("shows an empty state when the member search matches nobody", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [buildTask()] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^open confirm venue access$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /add member to/i }));
    fireEvent.change(screen.getByLabelText(/search members/i), {
      target: { value: "Nobody At All" },
    });

    expect(screen.getByText("No members found.")).toBeInTheDocument();
  });
});

/** The shape every success stub in this file shares. */
interface OkResponse {
  ok: true;
  status: number;
  json: () => Promise<unknown>;
}

function response(body: unknown): OkResponse {
  return { ok: true, status: 200, json: async () => body };
}

function roster() {
  const createdAt = "2026-01-01T00:00:00.000Z";
  return [
    {
      ...ada,
      email: "ada@example.com",
      role: "officer",
      tier: 0,
      teamIds: [],
      portfolio: null,
      createdAt,
    },
    {
      ...grace,
      email: "grace@example.com",
      role: "officer",
      tier: 0,
      teamIds: [],
      portfolio: null,
      createdAt,
    },
  ];
}

function buildTask() {
  return {
    id: taskId,
    eventId: null,
    teamId: null,
    assigneeIds: [],
    creator: null,
    title: "Confirm venue access",
    description: null,
    status: "todo",
    priority: "high",
    dueAt: null,
    boardOrder: 0,
    minTier: 0,
    completedAt: null,
    aiRunId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}
