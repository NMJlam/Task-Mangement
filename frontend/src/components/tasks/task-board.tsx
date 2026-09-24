import {
  insertAfter,
  taskStatusSchema,
  type EventSummary,
  type RosterMember,
  type Task,
  type TaskStatus,
  type UpdateTask,
} from "@ctp/shared";
import { CollisionPriority, type DragOperation } from "@dnd-kit/abstract";
import { Accessibility, type Draggable, type Droppable } from "@dnd-kit/dom";
import {
  DragDropProvider,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { useRef, useState } from "react";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { byBoardOrder } from "@/lib/task-order";
import { cn } from "@/lib/utils";

/** All four statuses, always — a column that disappears when empty hides stalled work. */
const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

/** The column a card is in IS its status, so the drop target's id is the status. */
function statusOf(value: unknown): TaskStatus | undefined {
  const parsed = taskStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function columnLabel(value: unknown): string {
  const status = statusOf(value);
  return columns.find((column) => column.status === status)?.label ?? "the board";
}

function titleOf(data: Record<string, unknown> | undefined): string {
  return typeof data?.title === "string" ? data.title : "The task";
}

/**
 * Where a drop lands, read off the operation alone.
 *
 * A card target means the library has already put the source where it looks —
 * the optimistic sorting plugin rewrites the dragged card's `group` and `index`
 * on every dragover — so the source's own numbers are the answer, and there is
 * nothing to recompute. A column target (an empty column, or the space under
 * the last card) is the end of that column: those places have no index to
 * report, because the column body is one droppable, not a list of slots.
 *
 * `index` is deliberately absent in the second case rather than guessed.
 */
function landingOf(
  operation: DragOperation<Draggable, Droppable>,
): { status: TaskStatus; index?: number } | undefined {
  const { source, target } = operation;
  if (!source || !isSortable(source) || !target) return undefined;
  if (isSortable(target)) {
    const status = statusOf(source.group);
    return status === undefined ? undefined : { status, index: source.index };
  }
  const status = statusOf(target.id);
  return status === undefined ? undefined : { status };
}

export function TaskBoard({
  tasks,
  members = [],
  events,
  busyId,
  error,
  emptyMessage,
  onMove,
  onEventChange,
  onUpdate,
}: {
  tasks: Task[];
  members?: RosterMember[];
  events?: EventSummary[];
  busyId?: string;
  error?: string;
  emptyMessage: string;
  onMove: (task: Task, status: TaskStatus, after: string | null) => void;
  onEventChange?: (task: Task, eventId: string | null) => void;
  onUpdate?: (task: Task, patch: UpdateTask) => void;
}) {
  const [openId, setOpenId] = useState<string>();
  const openTask = tasks.find((task) => task.id === openId);
  const busy = busyId !== undefined;
  const announced = useRef("");

  /**
   * The board as rendered, in one place. Both the columns below and the drop
   * handler read it, so the order on screen and the order a drop reasons about
   * cannot disagree.
   */
  const layout = columns.map((column) => ({
    ...column,
    tasks: tasks.filter((task) => task.status === column.status).sort(byBoardOrder),
  }));

  const columnIds = (status: TaskStatus) =>
    layout.find((column) => column.status === status)?.tasks.map((task) => task.id) ?? [];

  /**
   * The card the moved one should follow: the id one slot above where it
   * landed, or `null` at the top. Computed against the column *without* the
   * moved card, because that is the list the landing index indexes — the same
   * state the library placed the card in on screen. A column-body drop has no
   * index and means the end of the column.
   */
  function anchorFor(
    status: TaskStatus,
    movedId: string,
    index: number | undefined,
  ): string | null {
    const rest = columnIds(status).filter((id) => id !== movedId);
    return rest[(index ?? rest.length) - 1] ?? null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { operation, canceled } = event;
    if (canceled) return;
    const task = tasks.find((candidate) => candidate.id === operation.source?.id);
    const landing = landingOf(operation);
    if (!task || !landing) return;

    const after = anchorFor(landing.status, task.id, landing.index);
    const current = columnIds(landing.status);
    const next = insertAfter(current, task.id, after);
    // A drop that leaves the column exactly as it was is not a change, and
    // writing it would only make the failure path reachable for nothing.
    const unmoved =
      task.status === landing.status &&
      next.length === current.length &&
      next.every((id, index) => current[index] === id);
    if (unmoved) return;

    onMove(task, landing.status, after);
  }

  if (tasks.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <DragDropProvider
        // Replaces only the announcements: the library's id-only sentences are
        // useless here, and the column plus the position is the thing being
        // chosen. The default pointer, touch and keyboard sensors are left alone.
        plugins={(defaults) =>
          defaults.map((plugin) =>
            plugin === Accessibility
              ? Accessibility.configure({
                  screenReaderInstructions: {
                    draggable:
                      "Press Space to pick up a task. Use the arrow keys to move it within its column or into another one. Press Space to drop, or Escape to cancel.",
                  },
                  announcements: {
                    dragstart: (event: DragStartEvent) => {
                      announced.current = "";
                      return `Picked up ${titleOf(event.operation.source?.data)} from ${columnLabel(event.operation.source?.data?.status)}.`;
                    },
                    dragover: (event: DragOverEvent) => {
                      const landing = landingOf(event.operation);
                      if (!landing) return undefined;
                      const position =
                        landing.index === undefined
                          ? `the end of ${columnLabel(landing.status)}`
                          : `position ${landing.index + 1} in ${columnLabel(landing.status)}`;
                      // A dragover fires on every pointer move; only a change of
                      // place is news, or the reader is told the same sentence
                      // fifty times.
                      if (position === announced.current) return undefined;
                      announced.current = position;
                      return `Over ${position}.`;
                    },
                    dragend: (event: DragEndEvent) => {
                      const title = titleOf(event.operation.source?.data);
                      const from = columnLabel(event.operation.source?.data?.status);
                      if (event.canceled) return `Drop cancelled. ${title} stays in ${from}.`;
                      const landing = landingOf(event.operation);
                      if (!landing) {
                        return `Dropped ${title} outside a column. It stays in ${from}.`;
                      }
                      return landing.index === undefined
                        ? `Dropped ${title} at the end of ${columnLabel(landing.status)}.`
                        : `Dropped ${title} at position ${landing.index + 1} in ${columnLabel(landing.status)}.`;
                    },
                  },
                })
              : plugin,
          )
        }
        onDragEnd={handleDragEnd}
      >
        <section aria-label="Task board" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {layout.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              tasks={column.tasks}
              events={events}
              disabled={busy}
              assigneeCounts={onUpdate !== undefined}
              onOpen={(task) => setOpenId(task.id)}
            />
          ))}
        </section>
      </DragDropProvider>

      <TaskDetailDialog
        task={openTask}
        members={members}
        events={events}
        onClose={() => setOpenId(undefined)}
        onUpdate={
          onUpdate &&
          ((patch) => {
            if (openTask) onUpdate(openTask, patch);
          })
        }
        busy={openTask !== undefined && busyId === openTask.id}
        error={openTask ? error : undefined}
        onEventChange={onEventChange}
      />
    </>
  );
}

function BoardColumn({
  column,
  tasks,
  events,
  disabled,
  assigneeCounts,
  onOpen,
}: {
  column: { status: TaskStatus; label: string };
  tasks: Task[];
  events?: EventSummary[];
  disabled: boolean;
  assigneeCounts: boolean;
  onOpen: (task: Task) => void;
}) {
  // The whole column body accepts a card, not just the cards in it: dropping
  // into empty space is how an empty column gets filled. Its priority is low so
  // that a card always wins the collision — the body is what is behind them.
  const { ref, isDropTarget } = useDroppable({
    id: column.status,
    accept: "task",
    collisionPriority: CollisionPriority.Low,
  });

  return (
    <section aria-labelledby={`${column.status}-heading`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h3 id={`${column.status}-heading`} className="text-sm font-semibold">
          {column.label}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
      </div>
      <div
        ref={ref}
        className={cn(
          "grid min-h-20 gap-2 rounded-lg transition-colors motion-reduce:transition-none",
          isDropTarget && "bg-accent/60 ring-2 ring-ring/40 ring-inset",
        )}
      >
        {tasks.map((task, index) => (
          <TaskCard
            key={task.id}
            task={task}
            index={index}
            disabled={disabled}
            assigneeCount={assigneeCounts ? task.assigneeIds.length : undefined}
            eventTitle={
              task.eventId
                ? (events?.find((event) => event.id === task.eventId)?.title ?? "Linked event")
                : undefined
            }
            onOpen={onOpen}
          />
        ))}
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
            No tasks
          </div>
        )}
      </div>
    </section>
  );
}
