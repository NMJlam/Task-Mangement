import type { Task } from "@ctp/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TaskBoard } from "./task-board";

/**
 * Only the provider and the drag primitives are stood in for: the provider
 * captures the board's `onDragEnd` so a test can hand it the operation a real
 * drop would produce. jsdom has no layout, so dnd-kit's own collision detection
 * could never report a drop here. `SortableFake` is what `isSortable` accepts,
 * so the board's own guard runs rather than being bypassed by the mock.
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

/** A second card in the same column, for the reordering cases. */
const below: Task = {
  ...task,
  id: "018f3a4b-0000-7000-8000-000000000003",
  title: "Book the rig",
  boardOrder: 1,
};

/** Two cards in another column, so a cross-column drop has a slot to name. */
const other: Task = {
  ...task,
  id: "018f3a4b-0000-7000-8000-000000000004",
  title: "Print programmes",
  status: "in_progress",
  boardOrder: 0,
};
const otherBelow: Task = {
  ...task,
  id: "018f3a4b-0000-7000-8000-000000000005",
  title: "Hire chairs",
  status: "in_progress",
  boardOrder: 1,
};

/** A card as the drag has already left it: its column and slot are the landed ones. */
function dragged(card: Task, index: number, group: Task["status"] = card.status) {
  return new dnd.SortableFake({
    id: card.id,
    index,
    group,
    data: { title: card.title, status: card.status },
  });
}

/** A card sitting in a column, as the drop target. */
function landedOn(card: Task, index: number, group: Task["status"] = card.status) {
  return new dnd.SortableFake({ id: card.id, index, group });
}

/** The column body under the cards: one droppable, with no slot to report. */
function columnBody(status: Task["status"]) {
  return { id: status };
}

function drop(operation: { source: unknown; target: unknown }, canceled = false) {
  act(() => {
    dnd.onDragEnd?.({ canceled, operation });
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
  it("moves a card into another column when it is dropped on the column body", () => {
    const onMove = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={onMove}
      />,
    );

    // The card is the only one in its column, so the optimistic sort has
    // nothing to reindex: it is still at 0 when it lands.
    drop({ source: dragged(task, 0, "in_progress"), target: columnBody("in_progress") });

    expect(onMove).toHaveBeenCalledWith(task, "in_progress", null);
  });

  it("names the card above the slot it landed in", () => {
    const onMove = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task, below, other, otherBelow]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={onMove}
      />,
    );

    // Dropped on the second card of the other column: the library has already
    // re-slotted it to 1 there, so what it now follows is that column's first.
    drop({
      source: dragged(task, 1, "in_progress"),
      target: landedOn(otherBelow, 1, "in_progress"),
    });

    expect(onMove).toHaveBeenCalledWith(task, "in_progress", other.id);
  });

  it("moves the first card below the last within its own column", () => {
    const onMove = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task, below]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={onMove}
      />,
    );

    drop({ source: dragged(task, 1), target: landedOn(below, 1) });

    expect(onMove).toHaveBeenCalledWith(task, "todo", below.id);
  });

  it("asks for the end of the column when a card is dropped into empty space", () => {
    const onMove = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task, below]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={onMove}
      />,
    );

    // A column body has no slot to report, so the library has not reindexed the
    // source — it is only the board that knows this means the end.
    drop({ source: dragged(below, 1, "in_progress"), target: columnBody("in_progress") });

    expect(onMove).toHaveBeenCalledWith(below, "in_progress", null);
  });

  it("writes nothing when the drop leaves the column as it was", () => {
    const onMove = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task, below]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={onMove}
      />,
    );

    // Dropped back on its own slot: nothing below it to name, and the column
    // reads the same either way.
    drop({ source: dragged(task, 0), target: landedOn(task, 0) });

    expect(onMove).not.toHaveBeenCalled();
  });

  it("writes nothing for a cancelled drag, a drop outside a column, or an unknown target", () => {
    const onMove = vi.fn();
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={onMove}
      />,
    );

    drop({ source: dragged(task, 0, "in_progress"), target: columnBody("in_progress") }, true);
    drop({ source: dragged(task, 0), target: null });
    drop({ source: dragged(task, 0), target: { id: "not-a-status" } });

    expect(onMove).not.toHaveBeenCalled();
  });

  it("gives the drag handle and the open action distinct accessible names", () => {
    renderBoard(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
        onMove={vi.fn()}
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
});
