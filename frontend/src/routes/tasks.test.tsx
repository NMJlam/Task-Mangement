import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("TasksPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates tasks and shows them on the board", async () => {
    const task = buildTask();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST")
        return Promise.resolve(
          response({
            task: { ...task, id: "018f3a4b-0000-7000-8000-000000000002", title: "Book AV" },
          }),
        );
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [task] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksPage />);

    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^task$/i), { target: { value: "Book AV" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));
    await waitFor(() => expect(screen.getByText("Book AV")).toBeInTheDocument());
  });

  it("links a task to an event", async () => {
    const user = userEvent.setup();
    const task = buildTask();
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

    render(<TasksPage />);

    await user.click(await screen.findByRole("button", { name: /^open confirm venue access$/i }));
    await user.selectOptions(screen.getByLabelText("Linked event"), EVENT_ID);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ eventId: EVENT_ID }) }),
      );
    });
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

    render(<TasksPage />);
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

    render(<TasksPage />);
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

    render(<TasksPage />);
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

    render(<TasksPage />);
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

    render(<TasksPage />);
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

    render(<TasksPage />);
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

    render(<TasksPage />);

    expect(await screen.findByTitle("2 assignees")).toHaveTextContent("2");
  });

  it("shows an empty state when the search matches nobody", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/tasks") return Promise.resolve(response({ tasks: [buildTask()] }));
      if (url === "/api/members") return Promise.resolve(response({ members: roster() }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksPage />);
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
