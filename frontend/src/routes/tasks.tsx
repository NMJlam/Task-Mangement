import { taskPrioritySchema, taskStatusSchema, type Task, type TaskStatus } from "@ctp/shared";
import { ListPlus } from "lucide-react";
import type { FormEvent } from "react";
import { PageHeader } from "@/components/common/page-header";
import { PriorityDot } from "@/components/common/priority-dot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTasks } from "@/hooks/use-tasks";

const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];
const dueDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function TasksPage() {
  const tasks = useTasks();
  const taskItems = tasks.state.status === "ok" ? tasks.state.items : [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const priority = taskPrioritySchema.parse(data.get("priority"));
    if (!title) return;
    void tasks.createTask(title, priority).then((created) => {
      if (created) form.reset();
    });
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Tasks"
        description="Keep club work moving from first action to final handoff."
      />

      <Card className="mt-8 shadow-none">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ListPlus aria-hidden="true" className="size-5 text-muted-foreground" />
            Add Task
          </h2>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-[1fr_12rem_auto]" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="task-title">Task</Label>
              <Input
                id="task-title"
                name="title"
                autoComplete="off"
                placeholder="e.g. Confirm venue access"
                maxLength={200}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-priority">Priority</Label>
              <select
                id="task-priority"
                name="priority"
                defaultValue="medium"
                className="h-9 cursor-pointer rounded-md border bg-background px-3 text-sm capitalize outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {taskPrioritySchema.options.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </div>
            <Button className="self-end" disabled={Boolean(tasks.busy)}>
              {tasks.busy === "new" ? "Adding…" : "Add Task"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {tasks.mutationError && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {tasks.mutationError}. Try again.
        </p>
      )}
      {tasks.state.status === "loading" && (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          Loading Tasks…
        </p>
      )}
      {tasks.state.status === "error" && (
        <p className="mt-8 text-sm text-destructive" role="alert">
          Couldn&apos;t load tasks: {tasks.state.message}. Refresh the page to try again.
        </p>
      )}
      {tasks.state.status === "ok" && taskItems.length === 0 && (
        <Card className="mt-8 border-dashed shadow-none">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No tasks yet. Add the first task above.
          </CardContent>
        </Card>
      )}
      {tasks.state.status === "ok" && taskItems.length > 0 && (
        <section aria-label="Task board" className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => {
            const items = taskItems.filter((task) => task.status === column.status);
            return (
              <section key={column.status} aria-labelledby={`tasks-${column.status}`}>
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h2 id={`tasks-${column.status}`} className="text-sm font-semibold">
                    {column.label}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                <div className="grid gap-2">
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      busy={tasks.busy === task.id}
                      onStatusChange={(status) => void tasks.changeStatus(task, status)}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="rounded-lg border border-dashed px-3 py-10 text-center text-xs text-muted-foreground">
                      No tasks
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </section>
      )}
    </main>
  );
}

function TaskCard({
  task,
  busy,
  onStatusChange,
}: {
  task: Task;
  busy: boolean;
  onStatusChange: (status: TaskStatus) => void;
}) {
  return (
    <Card className="gap-4 py-4 shadow-none">
      <CardContent className="px-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5">
            <PriorityDot priority={task.priority} />
          </span>
          <h3 className="text-sm leading-5 font-medium">{task.title}</h3>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {task.dueAt ? `Due ${dueDate.format(task.dueAt)}` : "No due date"}
          </p>
          <div>
            <Label htmlFor={`status-${task.id}`} className="sr-only">
              Status for {task.title}
            </Label>
            <select
              id={`status-${task.id}`}
              value={task.status}
              disabled={busy}
              onChange={(event) => onStatusChange(taskStatusSchema.parse(event.target.value))}
              className="h-8 max-w-32 cursor-pointer rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {columns.map((column) => (
                <option key={column.status} value={column.status}>
                  {column.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
