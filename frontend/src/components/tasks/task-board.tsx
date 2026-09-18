import {
  taskStatusSchema,
  type EventSummary,
  type RosterMember,
  type Task,
  type TaskStatus,
  type UpdateTask,
} from "@ctp/shared";
import { Accessibility } from "@dnd-kit/dom";
import {
  DragDropProvider,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { useRef, useState } from "react";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { Card, CardContent } from "@/components/ui/card";
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

export function TaskBoard({
  tasks,
  members = [],
  events,
  busyId,
  error,
  emptyMessage,
  onStatusChange,
  onEventChange,
  onUpdate,
}: {
  tasks: Task[];
  members?: RosterMember[];
  events?: EventSummary[];
  busyId?: string;
  error?: string;
  emptyMessage: string;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onEventChange?: (task: Task, eventId: string | null) => void;
  onUpdate?: (task: Task, patch: UpdateTask) => void;
}) {
  const [openId, setOpenId] = useState<string>();
  const openTask = tasks.find((task) => task.id === openId);
  const busy = busyId !== undefined;
  const leftHomeColumn = useRef(false);

  function handleDragEnd(event: DragEndEvent) {
    const { operation, canceled } = event;
    if (canceled) return;
    const task = tasks.find((candidate) => candidate.id === operation.source?.id);
    const status = statusOf(operation.target?.id);
    if (!task || !status || task.status === status) return;
    onStatusChange(task, status);
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
        // useless here, and the column label is the thing being chosen. The
        // default pointer, touch and keyboard sensors are left alone.
        plugins={(defaults) =>
          defaults.map((plugin) =>
            plugin === Accessibility
              ? Accessibility.configure({
                  screenReaderInstructions: {
                    draggable:
                      "Press Space to pick up a task. Use the arrow keys to move it to a status column. Press Space to drop, or Escape to cancel.",
                  },
                  announcements: {
                    dragstart: (event: DragStartEvent) => {
                      leftHomeColumn.current = false;
                      return `Picked up ${titleOf(event.operation.source?.data)} from ${columnLabel(event.operation.source?.data?.status)}.`;
                    },
                    dragover: (event: DragOverEvent) => {
                      const over = statusOf(event.operation.target?.id);
                      const from = statusOf(event.operation.source?.data?.status);
                      if (over === from && !leftHomeColumn.current) return undefined;
                      leftHomeColumn.current = over !== from;
                      return `Over ${columnLabel(event.operation.target?.id)}.`;
                    },
                    dragend: (event: DragEndEvent) => {
                      const title = titleOf(event.operation.source?.data);
                      const from = columnLabel(event.operation.source?.data?.status);
                      if (event.canceled) return `Drop cancelled. ${title} stays in ${from}.`;
                      return event.operation.target
                        ? `Dropped ${title} into ${columnLabel(event.operation.target.id)}.`
                        : `Dropped ${title} outside a column. It stays in ${from}.`;
                    },
                  },
                })
              : plugin,
          )
        }
        onDragEnd={handleDragEnd}
      >
        <section aria-label="Task board" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              column={column}
              tasks={tasks.filter((task) => task.status === column.status)}
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
  // into empty space is how an empty column gets filled.
  const { ref, isDropTarget } = useDroppable({ id: column.status, accept: "task" });

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
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
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
