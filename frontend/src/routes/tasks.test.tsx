import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./tasks";

describe("TasksPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates tasks and changes their status", async () => {
    const task = buildTask();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ tasks: [task] }))
      .mockResolvedValueOnce(
        response({
          task: { ...task, id: "018f3a4b-0000-7000-8000-000000000002", title: "Book AV" },
        }),
      )
      .mockResolvedValueOnce(response({ task: { ...task, status: "in_progress" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksPage />);

    await waitFor(() => expect(screen.getByText("Confirm venue access")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^task$/i), { target: { value: "Book AV" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));
    await waitFor(() => expect(screen.getByText("Book AV")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/status for confirm venue access/i), {
      target: { value: "in_progress" },
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/tasks/${task.id}/status`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });
});

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
