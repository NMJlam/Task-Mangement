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

const EVENT_ID = "018f3a4b-0000-7000-8000-000000000010";

describe("TasksPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates tasks and shows them on the board", async () => {
    const task = buildTask();
    stubApi(task);

    render(<TasksPage />);

    await screen.findByText("Confirm venue access");
    fireEvent.change(screen.getByLabelText(/^task$/i), { target: { value: "Book AV" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    await waitFor(() => expect(screen.getByText("Book AV")).toBeInTheDocument());
  });

  it("opens a task modal and links the task to an event", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const fetchMock = stubApi(task);

    render(<TasksPage />);

    await user.click(await screen.findByRole("button", { name: /open confirm venue access/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
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
    const fetchMock = stubApi(task);

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
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/tasks/${task.id}/status`)
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (url === "/api/events") return Promise.resolve(response({ items: [buildEvent()] }));
      if (url === "/api/members") return Promise.resolve(response({ members: [] }));
      return Promise.resolve(response({ tasks: [task] }));
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

  it("opens the task modal from the card's overlay button", async () => {
    const task = buildTask();
    stubApi(task);

    render(<TasksPage />);

    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // jsdom cannot hit-test, so this clicks the overlay the card body is covered
    // by; that a click on the visible title reaches it is a browser concern and
    // is covered by the manual pass.
    fireEvent.click(screen.getByRole("button", { name: /open confirm venue access/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Confirm venue access" }),
    ).toBeInTheDocument();
  });
});

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
        source: {
          id: "018f3a4b-0000-7000-8000-000000000001",
          data: { title: "Confirm venue access", status: "todo" },
        },
        target: { id: status },
      },
    });
  });
}

function stubApi(task: ReturnType<typeof buildTask>) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/tasks" && init?.method === "POST") {
      return Promise.resolve(
        response({
          task: { ...task, id: "018f3a4b-0000-7000-8000-000000000002", title: "Book AV" },
        }),
      );
    }
    if (url === `/api/tasks/${task.id}/status`) {
      return Promise.resolve(response({ task: { ...task, status: "in_progress" } }));
    }
    if (url === `/api/tasks/${task.id}`) {
      return Promise.resolve(response({ task: { ...task, eventId: EVENT_ID } }));
    }
    if (url === "/api/events") {
      return Promise.resolve(response({ items: [buildEvent()], nextCursor: null }));
    }
    if (url === "/api/members") return Promise.resolve(response({ members: [] }));
    return Promise.resolve(response({ tasks: [task] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The shape every success stub in this file shares. */
interface OkResponse {
  ok: true;
  status: number;
  json: () => Promise<unknown>;
}

function response(body: unknown): OkResponse {
  return { ok: true, status: 200, json: async () => body };
}

function buildTask() {
  return {
    id: "018f3a4b-0000-7000-8000-000000000001",
    eventId: null,
    teamId: null,
    assignee: null,
    creator: null,
    title: "Confirm venue access",
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

function buildEvent() {
  return {
    id: EVENT_ID,
    title: "Winter Showcase",
    status: "planning",
    startsAt: "2026-11-01T10:00:00.000Z",
    endsAt: null,
    venue: null,
    minTier: 0,
    owner: null,
    taskCounts: { todo: 0, inProgress: 0, blocked: 0, done: 0 },
    overdueCount: 0,
    budget: { allocationCents: 0, committedCents: 0, spentCents: 0 },
  };
}
