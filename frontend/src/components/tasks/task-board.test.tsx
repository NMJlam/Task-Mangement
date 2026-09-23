import type { Task } from "@ctp/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TaskBoard } from "./task-board";

/**
 * Only the provider is stood in for: it captures the board's `onDragEnd` so a
 * test can hand it the operation a real drop would produce. jsdom has no layout,
 * so dnd-kit's own collision detection could never report a drop here.
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

const task: Task = {
  id: "018f3a4b-0000-7000-8000-000000000002",
  eventId: "018f3a4b-0000-7000-8000-000000000001",
  teamId: null,
  assigneeIds: ["018f3a4b-0000-7000-8000-00000000000a"],
  creator: null,
  title: "Confirm lighting",
  description: null,
  status: "todo",
  priority: "high",
  dueAt: new Date("2026-07-10T09:00:00.000Z"),
  boardOrder: 0,
  minTier: 0,
  completedAt: null,
  aiRunId: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
};

const members = [
  {
    id: "018f3a4b-0000-7000-8000-00000000000a",
    email: "ada@example.com",
    name: "Ada Lovelace",
    role: "officer" as const,
    tier: 0 as const,
    portfolio: null,
    teamIds: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];

function drop(overrides: { targetId?: string; canceled?: boolean } = {}) {
  act(() => {
    dnd.onDragEnd?.({
      canceled: overrides.canceled ?? false,
      operation: {
        source: { id: task.id, data: { title: task.title, status: task.status } },
        target: overrides.targetId === undefined ? null : { id: overrides.targetId },
      },
    });
  });
}

/**
 * The dialog links to the task's event, so every render needs a router in
 * scope even when the assertion has nothing to do with navigation.
 */
function renderBoard(ui: ReactElement) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {ui}
    </MemoryRouter>,
  );
}

describe("TaskBoard", () => {
  it("changes status when a card is dropped on another column", () => {
    const onStatusChange = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={onStatusChange}
      />,
    );

    drop({ targetId: "in_progress" });

    expect(onStatusChange).toHaveBeenCalledWith(task, "in_progress");
  });

  it("writes nothing for a cancelled drag, a same-column drop, or an unknown target", () => {
    const onStatusChange = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={onStatusChange}
      />,
    );

    drop({ targetId: "in_progress", canceled: true });
    drop({ targetId: "todo" });
    drop({ targetId: "not-a-status" });
    drop();

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("gives the drag handle and the open action distinct accessible names", () => {
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Move Confirm lighting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Confirm lighting" })).toBeInTheDocument();
  });

  // The column a card sits in is the only status control now.
  it("renders no status selector", () => {
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/status for/i)).not.toBeInTheDocument();
  });

  it("renders the supplied empty message", () => {
    renderBoard(
      <TaskBoard
        tasks={[]}
        emptyMessage="No tasks yet. Add the first task above."
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No tasks yet. Add the first task above.")).toBeInTheDocument();
  });

  it("opens a task's details in a modal and names the assignee", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirm lighting" })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("closes the modal on Escape", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says nobody is assigned rather than inventing a name", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[{ ...task, assigneeIds: [] }]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });

  it("lists every assignee, and names an id the roster no longer holds", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[
          {
            ...task,
            assigneeIds: [...task.assigneeIds, "018f3a4b-0000-7000-8000-00000000000f"],
          },
        ]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Former Member")).toBeInTheDocument();
  });

  // The dialog's Due date row is the same control the create modal uses, so a
  // card's deadline is edited through one popover, not a second code path.
  it("edits a card's deadline through the shared date picker", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    const dialog = await screen.findByRole("dialog");

    // The stored deadline is what the trigger shows and what the grid opens on.
    const stored = task.dueAt!;
    await user.click(within(dialog).getByLabelText(/^due date$/i));
    // A day other than the stored one, still inside a 42-cell month grid.
    const next = new Date(stored.getFullYear(), stored.getMonth(), stored.getDate() + 1);
    const isoDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
      next.getDate(),
    ).padStart(2, "0")}`;
    const cell = document.querySelector(`[data-day="${isoDate}"]`);
    if (!cell) throw new Error(`No calendar cell for ${isoDate}`);
    await user.click(within(cell as HTMLElement).getByRole("button"));
    // The field opens holding the stored deadline's time, so it is replaced
    // rather than appended to.
    const timeField = screen.getByLabelText("Deadline time");
    await user.clear(timeField);
    await user.type(timeField, "11:00");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onUpdate).toHaveBeenCalledWith(task, {
      dueAt: new Date(next.getFullYear(), next.getMonth(), next.getDate(), 11, 0),
    });
  });

  // A caller that wires no mutation still gets the read-only presentation of the
  // same fields, which is what a board with no `onUpdate` relies on.
  it("offers no assignment editor without an onUpdate handler", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByLabelText(/search members/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add member to/i })).not.toBeInTheDocument();
    // The due date is shown as text in this branch, with no picker to open.
    expect(screen.queryByLabelText(/^due date$/i)).not.toBeInTheDocument();
  });

  // With `onUpdate` given the dialog edits the task; the board supplies the task.
  it("forwards a dialog patch for the open task when onUpdate is given", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    const dialog = await screen.findByRole("dialog");
    const field = screen.getByLabelText(/^description$/i);
    fireEvent.change(field, { target: { value: "Chairs" } });
    fireEvent.blur(field);

    expect(onUpdate).toHaveBeenCalledWith(task, { description: "Chairs" });
    expect(within(dialog).getByRole("button", { name: /add member to/i })).toBeInTheDocument();

    // The priority selector writes through the same channel, tagged with the
    // open task — the board, not the dialog, owns which task is being edited.
    await user.selectOptions(within(dialog).getByLabelText(/^priority$/i), "urgent");
    expect(onUpdate).toHaveBeenCalledWith(task, { priority: "urgent" });
  });

  // Deleting is tier-gated on the server (`authorise(1)` on DELETE /api/tasks/:id),
  // and the board mirrors that by receiving `onDelete` only from a caller who
  // may use it — an officer's dialog has no button to press.
  it("offers no delete control when the caller cannot delete tasks", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    await screen.findByRole("dialog");

    expect(screen.queryByRole("button", { name: "Delete Task" })).not.toBeInTheDocument();
  });

  // The row is gone for good once this lands — there is no soft delete to
  // restore from, so the first click only asks.
  it("asks before deleting, and deletes nothing when the reader backs out", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => true);
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    await user.click(await screen.findByRole("button", { name: "Delete Task" }));

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep Task" }));

    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  // The Delete Task button unmounts when the question replaces it, so without
  // this focus lands on the document body: a keyboard reader would be left with
  // no idea a question had been asked, and nothing announced.
  it("moves focus to the safe answer when the confirmation appears", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onDelete={vi.fn(async () => true)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    await user.click(await screen.findByRole("button", { name: "Delete Task" }));

    expect(screen.getByRole("button", { name: "Keep Task" })).toHaveFocus();
    // And the reader hears what they would be confirming, not a bare verb.
    expect(screen.getByRole("button", { name: "Confirm Delete" })).toHaveAccessibleDescription(
      /cannot be undone/i,
    );
  });

  // Backing out unmounts the question the same way asking it unmounted the
  // button, so focus has to be handed back rather than dropped on the body.
  it("returns focus to the delete control when the reader backs out", async () => {
    const user = userEvent.setup();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onDelete={vi.fn(async () => true)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    await user.click(await screen.findByRole("button", { name: "Delete Task" }));
    await user.click(screen.getByRole("button", { name: "Keep Task" }));

    expect(screen.getByRole("button", { name: "Delete Task" })).toHaveFocus();
  });

  it("deletes the task and closes the dialog once the reader confirms", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => true);
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    await user.click(await screen.findByRole("button", { name: "Delete Task" }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete" }));

    expect(onDelete).toHaveBeenCalledWith(task);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // A dialog that closed on a failed delete would read as success and leave the
  // card on the board with no explanation.
  it("keeps the dialog open and says so when the delete does not land", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => false);
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    await user.click(await screen.findByRole("button", { name: "Delete Task" }));
    await user.click(screen.getByRole("button", { name: "Confirm Delete" }));

    expect(await screen.findByText(/couldn't delete this task/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Delete" })).toBeInTheDocument();
  });
});
