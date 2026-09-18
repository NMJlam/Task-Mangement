import { taskPrioritySchema } from "@ctp/shared";
import { ListPlus } from "lucide-react";
import type { FormEvent } from "react";
import { PageHeader } from "@/components/common/page-header";
import { TaskBoard } from "@/components/tasks/task-board";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEvents } from "@/hooks/use-events";
import { useMembers } from "@/hooks/use-members";
import { useTasks } from "@/hooks/use-tasks";

export function TasksPage() {
  const tasks = useTasks();
  // The roster is one club-sized page, and so is the event list, so both are
  // searched in memory rather than asking the server for one row.
  const events = useEvents();
  const members = useMembers();
  const taskItems = tasks.state.status === "ok" ? tasks.state.items : [];
  const eventItems = events.state.status === "ok" ? events.state.items : undefined;
  const memberItems = members.state.status === "ok" ? members.state.items : [];

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
      {tasks.state.status === "ok" && (
        <div className="mt-8">
          <TaskBoard
            tasks={taskItems}
            members={memberItems}
            events={eventItems}
            busyTaskId={tasks.busy}
            emptyMessage="No tasks yet. Add the first task above."
            onStatusChange={(task, status) => void tasks.changeStatus(task, status)}
            onEventChange={(task, eventId) => void tasks.changeEvent(task, eventId)}
          />
        </div>
      )}
    </main>
  );
}
