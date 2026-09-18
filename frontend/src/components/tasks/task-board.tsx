import type { EventSummary, RosterMember, Task, TaskStatus } from "@ctp/shared";
import { useState, type DragEvent } from "react";
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

interface TaskBoardProps {
  tasks: Task[];
  members?: RosterMember[];
  events?: EventSummary[];
  busyTaskId?: string;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onEventChange?: (task: Task, eventId: string | null) => void;
}

export function TaskBoard({
  tasks,
  members = [],
  events,
  busyTaskId,
  onStatusChange,
  onEventChange,
}: TaskBoardProps) {
  const [openTaskId, setOpenTaskId] = useState<string>();
  const [draggedTaskId, setDraggedTaskId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<TaskStatus>();
  const openTask = tasks.find((task) => task.id === openTaskId);

  function drop(event: DragEvent, status: TaskStatus) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = tasks.find((item) => item.id === taskId);
    if (task && task.status !== status) onStatusChange?.(task, status);
    setDraggedTaskId(undefined);
    setDropTarget(undefined);
  }

  function move(task: Task, direction: -1 | 1) {
    const next = columns[columns.findIndex((column) => column.status === task.status) + direction];
    if (next) onStatusChange?.(task, next.status);
  }

  if (tasks.length === 0) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No tasks are linked to this event yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {onStatusChange && (
        <p className="mb-3 text-xs text-muted-foreground">
          Drag cards between columns. Keyboard: focus a card and use Alt + Left or Right.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => {
          const items = tasks.filter((task) => task.status === column.status);
          return (
            <section
              key={column.status}
              aria-labelledby={`${column.status}-heading`}
              onDragOver={(event) => {
                if (!onStatusChange) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(column.status);
              }}
              onDrop={onStatusChange ? (event) => drop(event, column.status) : undefined}
              className={cn(
                "rounded-xl transition-[background-color,box-shadow]",
                dropTarget === column.status && "bg-accent/50 ring-2 ring-ring/40",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h3 id={`${column.status}-heading`} className="text-sm font-semibold">
                  {column.label}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </div>
              <div className="grid gap-2">
                {items.map((task) => (
                  <div
                    key={task.id}
                    draggable={Boolean(onStatusChange) && busyTaskId !== task.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                      setDraggedTaskId(task.id);
                    }}
                    onDragEnd={() => {
                      setDraggedTaskId(undefined);
                      setDropTarget(undefined);
                    }}
                    className={cn(draggedTaskId === task.id && "opacity-50")}
                  >
                    <TaskCard
                      task={task}
                      onOpen={(item) => setOpenTaskId(item.id)}
                      eventTitle={
                        task.eventId
                          ? (events?.find((event) => event.id === task.eventId)?.title ??
                            "Linked event")
                          : undefined
                      }
                      onMove={
                        onStatusChange && busyTaskId !== task.id
                          ? (direction) => move(task, direction)
                          : undefined
                      }
                    />
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
                    No tasks
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <TaskDetailDialog
        task={openTask}
        members={members}
        events={events}
        busy={busyTaskId === openTask?.id}
        onEventChange={onEventChange}
        onClose={() => setOpenTaskId(undefined)}
      />
    </>
  );
}
