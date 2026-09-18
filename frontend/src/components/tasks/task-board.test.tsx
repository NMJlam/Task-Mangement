import type { Task } from "@ctp/shared";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  assignee: "018f3a4b-0000-7000-8000-00000000000a",
  creator: null,
  title: "Confirm lighting",
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

const events = [
  { id: "018f3a4b-0000-7000-8000-000000000001", title: "Winter Showcase" },
] as unknown as Parameters<typeof TaskBoard>[0]["events"];

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

describe("TaskBoard", () => {
  it("changes status when a card is dropped on another column", () => {
    const onStatusChange = vi.fn();
    render(
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
    render(
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
    render(
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
    render(
      <TaskBoard
        tasks={[task]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/status for/i)).not.toBeInTheDocument();
  });

  it("renders the supplied empty message", () => {
    render(
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
    render(
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
    render(
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
    render(
      <TaskBoard
        tasks={[{ ...task, assignee: null }]}
        members={members}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));

    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
  });

  // The event link belongs to /tasks: the link control needs the event list and
  // the write path, and an event's own tab supplies neither.
  it("links an event from the dialog when onEventChange is given", async () => {
    const user = userEvent.setup();
    const onEventChange = vi.fn();
    render(
      <TaskBoard
        tasks={[{ ...task, eventId: null }]}
        members={members}
        events={events}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
        onEventChange={onEventChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));
    const select = await screen.findByLabelText("Linked event");

    await user.selectOptions(select, "018f3a4b-0000-7000-8000-000000000001");

    expect(onEventChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id }),
      "018f3a4b-0000-7000-8000-000000000001",
    );
  });

  it("offers no event link control without an onEventChange handler", async () => {
    const user = userEvent.setup();
    render(
      <TaskBoard
        tasks={[task]}
        members={members}
        events={events}
        emptyMessage="No tasks are linked to this event yet."
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open Confirm lighting" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByLabelText("Linked event")).not.toBeInTheDocument();
  });
});
