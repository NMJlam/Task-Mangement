import type { RosterMember, Task, TaskStatus } from "@ctp/shared";
import { useState } from "react";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { Card, CardContent } from "@/components/ui/card";

/** All four statuses, always — a column that disappears when empty hides stalled work. */
const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export function TaskBoard({ tasks, members = [] }: { tasks: Task[]; members?: RosterMember[] }) {
  const [openTask, setOpenTask] = useState<Task>();

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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => {
          const items = tasks.filter((task) => task.status === column.status);
          return (
            <section key={column.status} aria-labelledby={`${column.status}-heading`}>
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h3 id={`${column.status}-heading`} className="text-sm font-semibold">
                  {column.label}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </div>
              <div className="grid gap-2">
                {items.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={setOpenTask} />
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

      <TaskDetailDialog task={openTask} members={members} onClose={() => setOpenTask(undefined)} />
    </>
  );
}
