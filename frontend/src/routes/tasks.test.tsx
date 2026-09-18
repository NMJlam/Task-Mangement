import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./tasks";

describe("TasksPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a task modal and links the task to an event", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    const fetchMock = stubApi(task);

    render(<TasksPage />);

    await user.click(await screen.findByRole("button", { name: /confirm venue access/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Linked event"), EVENT_ID);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ eventId: EVENT_ID }) }),
      );
    });
  });

  it("moves cards between columns by drag and drop", async () => {
    const task = buildTask();
    const fetchMock = stubApi(task);

    render(<TasksPage />);

    const card = await screen.findByRole("button", { name: /confirm venue access/i });
    const draggable = card.closest("[draggable='true']");
    const target = screen.getByRole("region", { name: "In Progress" });
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };

    expect(draggable).not.toBeNull();
    fireEvent.dragStart(draggable!, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status: "in_progress" }),
        }),
      ),
    );
  });

  it("creates tasks", async () => {
    const user = userEvent.setup();
    const task = buildTask();
    stubApi(task);

    render(<TasksPage />);

    await screen.findByText("Confirm venue access");
    fireEvent.change(screen.getByLabelText(/^task$/i), { target: { value: "Book AV" } });
    await user.click(screen.getByRole("button", { name: /add task/i }));
    await waitFor(() => expect(screen.getByText("Book AV")).toBeInTheDocument());
  });
});

const EVENT_ID = "018f3a4b-0000-7000-8000-000000000010";

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

function response(body: unknown) {
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
